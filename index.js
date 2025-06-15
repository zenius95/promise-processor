class PromiseProcessor {
  constructor(promiseHandler, data, options = {}) {
    if (!Array.isArray(data)) {
      throw new Error("Data must be an array");
    }

    this.promiseHandler = promiseHandler;
    this.originalData = data;

    this.delay = options.delay ?? 0;
    this.concurrency = options.concurrency ?? 1;
    this.timeout = options.timeout ?? 0;
    this.retryDelay = options.retryDelay ?? 0;
    this.maxRetries = options.maxRetries ?? 0;
    this.maxTotalErrors = options.maxTotalErrors ?? Infinity;

    this.hooks = {
      onStart: options.onStart,
      onFinish: options.onFinish,
      onError: options.onError,
      onPause: options.onPause,
      onResume: options.onResume,
      onRetry: options.onRetry,
      onTimeout: options.onTimeout,
      onDelay: options.onDelay,
    };

    this.entries = data.map((item, index) => [index, item]);
    this.results = new Array(this.entries.length);

    this.currentIndex = 0;
    this.running = 0;
    this.totalErrors = 0;
    this.stopped = false;
    this.immediateStop = false;
    this.resolved = false;
    this.waiters = [];

    this.result = new Promise((resolve, reject) => {
      this._resolveAll = resolve;
      this._rejectAll = reject;
    });

    this._lastStartTime = null; // ⏱️ thời điểm task trước bắt đầu
    this._lock = Promise.resolve(); // 🔒 dùng để tuần tự hoá delay giữa các task
  }

  _wait(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async _runWithTimeout(promise, key, item) {
    if (!this.timeout) return promise;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const err = new Error(`Timeout`);
        this.hooks.onTimeout?.(key, item, err);
        reject(err);
      }, this.timeout);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  _getMaxRetries(item, key) {
    return typeof this.maxRetries === "function"
      ? this.maxRetries(item, key)
      : this.maxRetries;
  }

  async _attemptRun(key, item) {
    const maxRetry = this._getMaxRetries(item, key);
    let attempt = 0;

    while (attempt <= maxRetry) {
      try {
        if (attempt > 0 && this.retryDelay) {
          await this._wait(this.retryDelay);
        }
        return await this._runWithTimeout(this.promiseHandler(item), key, item);
      } catch (err) {
        if (attempt === maxRetry) throw err;
        attempt++;
        this.hooks.onRetry?.(key, item, attempt, err);
      }
    }
  }

  async _worker() {
    while (!this.immediateStop && !this.resolved) {
      if (this.stopped) {
        await new Promise((resume) => this.waiters.push(resume));
        if (this.immediateStop || this.resolved) return;
      }

      let key, item;

      // 🔒 Sử dụng lock để tuần tự hóa delay giữa các task
      await (this._lock = this._lock.then(async () => {
        if (this.currentIndex >= this.entries.length) return;

        [key, item] = this.entries[this.currentIndex++];

        // ⏱️ Delay giữa các task (chỉ delay nếu không phải task đầu tiên)
        if (this._lastStartTime !== null && this.delay > 0) {
          this.hooks.onDelay?.(key, item, this.delay);
          await this._wait(this.delay);
        }

        // 🕒 Đánh dấu thời điểm task bắt đầu
        this._lastStartTime = Date.now();
      }));

      // Nếu đã lấy hết task
      if (key === undefined) break;

      this.running++;

      try {
        this.hooks.onStart?.(key, item);
        const result = await this._attemptRun(key, item);
        this.results[key] = result;
        this.hooks.onFinish?.(key, item, result);
      } catch (err) {
        this.totalErrors++;
        this.results[key] = { error: err };
        this.hooks.onError?.(key, item, err);

        if (this.totalErrors >= this.maxTotalErrors) {
          this.immediateStop = true;
          this._rejectAll(new Error(`Exceeded maxTotalErrors (${this.maxTotalErrors})`));
          return;
        }
      }

      this.running--;

      if (
        this.currentIndex >= this.entries.length &&
        this.running === 0 &&
        !this.resolved
      ) {
        this.resolved = true;
        this._resolveAll(this.results);
        return;
      }
    }
  }

  async start() {
    if (this.resolved || this.immediateStop) return;
    const workers = Array.from({ length: this.concurrency }, () => this._worker());
    await Promise.all(workers);
  }

  stop(immediate = false) {
    if (immediate && !this.resolved) {
      this.immediateStop = true;
      this.resolved = true;
      this._rejectAll(new Error("Stopped immediately"));
    } else {
      this.stopped = true;
      this.hooks.onPause?.(this.originalData);
    }
  }

  resume() {
    if (!this.stopped || this.resolved || this.immediateStop) return;
    this.stopped = false;
    this.hooks.onResume?.(this.originalData);
    const waiters = [...this.waiters];
    this.waiters = [];
    waiters.forEach((resume) => resume());
  }
}

module.exports = PromiseProcessor;
