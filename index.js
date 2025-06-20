
class PromiseProcessor {
  constructor(promiseHandler, data, options = {}) {
    if (!Array.isArray(data)) throw new Error("Data must be an array");

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
      onStopped: options.onStopped,
    };

    this.entries = data.map((item, index) => [index, item]);
    this.results = new Array(this.entries.length);
    this._controllers = new Map();

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

    this._lastStartTime = null;
    this._lock = Promise.resolve();
  }

  _wait(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async _waitInterruptible(ms) {
    const interval = 50;
    let waited = 0;
    while (waited < ms) {
      if (this.immediateStop) break;
      const next = Math.min(interval, ms - waited);
      await this._wait(next);
      waited += next;
    }
  }

  _getMaxRetries(item, key) {
    return typeof this.maxRetries === "function"
      ? this.maxRetries(item, key)
      : this.maxRetries;
  }

  async _runWithTimeout(promise, key, item) {
    if (!this.timeout) return promise;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const err = new Error("Timeout");
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

  async _attemptRun(key, item) {
    const maxRetry = this._getMaxRetries(item, key);
    let attempt = 0;

    while (attempt <= maxRetry) {
      if (this.immediateStop) throw new Error("Stopped immediately");
      try {
        if (attempt > 0 && this.retryDelay) {
          await this._waitInterruptible(this.retryDelay);
        }

        const controller = new AbortController();
        this._controllers.set(key, controller);

        const task = this.promiseHandler(item, controller.signal);
        const result = await this._runWithTimeout(task, key, item);

        this._controllers.delete(key);
        return result;
      } catch (err) {
        this._controllers.delete(key);
        if (attempt === maxRetry || this.immediateStop) throw err;
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
      await (this._lock = this._lock.then(async () => {
        if (this.currentIndex >= this.entries.length) return;
        [key, item] = this.entries[this.currentIndex++];

        if (this._lastStartTime !== null && this.delay > 0) {
          this.hooks.onDelay?.(key, item, this.delay);
          await this._waitInterruptible(this.delay);
        }

        this._lastStartTime = Date.now();
      }));

      if (key === undefined || this.immediateStop) break;

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

        if (this.immediateStop && err.message === "Stopped immediately") {
          this.hooks.onStopped?.("immediate");
          return;
        }

        if (this.totalErrors >= this.maxTotalErrors) {
          this.immediateStop = true;
          this._rejectAll(new Error(`Exceeded maxTotalErrors (${this.maxTotalErrors})`));
          this.hooks.onStopped?.("immediate");
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

    try {
      await Promise.all(workers);
    } catch (err) {
      if (err.message !== "Stopped immediately" && !this.immediateStop) {
        throw err;
      }
    }
  }

  stop(immediate = false) {
    if (immediate && !this.resolved) {
      this.immediateStop = true;
      this.resolved = true;
      this._controllers.forEach((controller) => controller.abort());
      this._controllers.clear();
      this._rejectAll(new Error("Stopped immediately"));
      this.hooks.onStopped?.("immediate");
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
