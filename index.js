class PromiseProcessor {
  constructor(promiseHandler, data, options = {}) {
    if (!Array.isArray(data)) throw new Error("Data must be an array");

    this.promiseHandler = promiseHandler;
    this.originalData = data;

    this.delay = options.delay ?? 0;
    this.concurrency = options.concurrency === 0 ? data.length : options.concurrency ?? 1;
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
      onMessage: options.onMessage,
      onMaxTotalErrors: options.onMaxTotalErrors,
      onGetItemError: options.onGetItemError
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

    this._lastStartTime = null;
    this._lock = Promise.resolve();
    this.abortControllers = new Map();

    this.result = new Promise((resolve) => {
      this._resolveAll = (results) => {
        this.hooks.onStopped?.();
        resolve(results);
      };

      this._rejectAll = () => {
        this.hooks.onStopped?.();
        resolve(this.results);
      };
    });
  }

  _wrapWithAbort(fn, signal) {
    return new Promise((resolve, reject) => {
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        signal.removeEventListener("abort", onAbort);
        reject(new Error("Aborted by signal"));
      };
      signal.addEventListener("abort", onAbort);

      (async () => {
        try {
          const result = await fn();
          if (!aborted) {
            signal.removeEventListener("abort", onAbort);
            resolve(result);
          }
        } catch (err) {
          if (!aborted) {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          }
        }
      })();
    });
  }

  _isAbortError(err) {
    return (
      err?.message === "Aborted" ||
      err?.message === "Aborted by signal" ||
      err?.message === "Stopped immediately"
    );
  }

  _wait(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async _runWithTimeout(promiseFn, key, item, signal) {
    if (!this.timeout) return this._wrapWithAbort(promiseFn, signal);

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const err = new Error("Timeout");
        this.hooks.onTimeout?.(key, item, err);
        reject(err);
      }, this.timeout);
    });

    try {
      const result = await Promise.race([
        this._wrapWithAbort(promiseFn, signal),
        timeoutPromise
      ]);
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

  async _attemptRun(key, item, signal) {
    const maxRetry = this._getMaxRetries(item, key);
    let attempt = 0;

    const message = (data) => {
      this.hooks.onMessage?.(key, item, data);
    };

    while (attempt <= maxRetry) {
      if (this.immediateStop || signal.aborted) {
        throw new Error("Stopped immediately");
      }

      try {
        if (attempt > 0 && this.retryDelay) {
          await this._wait(this.retryDelay);
        }

        if (this.immediateStop || signal.aborted) {
          throw new Error("Stopped immediately");
        }

        return await this._runWithTimeout(
          () => this.promiseHandler(item, message, signal),
          key,
          item,
          signal
        );
      } catch (err) {
        const isStopped = this.immediateStop || signal.aborted || this._isAbortError(err);

        if (isStopped || attempt === maxRetry) {
          throw err;
        }

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
          await this._wait(this.delay);
        }

        this._lastStartTime = Date.now();
      }));

      if (key === undefined) break;

      const controller = new AbortController();
      const signal = controller.signal;
      this.abortControllers.set(key, controller);

      this.running++;

      try {
        this.hooks.onStart?.(key, item);
        const result = await this._attemptRun(key, item, signal);
        this.results[key] = result;
        this.hooks.onFinish?.(key, item, result);
      } catch (err) {
        this.totalErrors++;
        this.results[key] = { error: err };

        const type = this._isAbortError(err) || this.immediateStop || signal.aborted
          ? "stopped"
          : "error";

        this.hooks.onError?.(key, item, err, type);

        if (this.totalErrors >= this.maxTotalErrors) {
          this.immediateStop = true;
          this.hooks.onMaxTotalErrors?.(this.totalErrors, this.maxTotalErrors);
          this._rejectAll();
          return;
        }
      } finally {
        this.abortControllers.delete(key);
        this.running--;
      }

      if (this.currentIndex >= this.entries.length && this.running === 0 && !this.resolved) {
        this.resolved = true;
        this._resolveAll(this.results);
        return;
      }
    }
  }

  async start() {
    if (this.resolved || this.immediateStop) return this.result;
    const workers = Array.from({ length: this.concurrency }, () => this._worker());
    await Promise.all(workers);
    return this.result;
  }

  stop(immediate = false) {
    if (immediate && !this.resolved) {
      this.immediateStop = true;
      for (const controller of this.abortControllers.values()) {
        controller.abort();
      }
      this.abortControllers.clear();
      this._rejectAll();
      this.resolved = true;
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

class StreamingPromiseProcessor extends PromiseProcessor {
  constructor(promiseHandler, getNextItem, options = {}) {
    super(promiseHandler, [], options);

    if (typeof getNextItem !== 'function') {
      throw new Error('getNextItem must be a function');
    }

    this.getNextItem = getNextItem;
    this._nextKey = 0;
    this._isLooping = false;
  }

  async _loop() {
    if (this._isLooping) return;
    this._isLooping = true;

    while (!this.resolved && !this.immediateStop) {
      if (this.stopped) {
        await new Promise((resume) => this.waiters.push(resume));
        if (this.immediateStop || this.resolved) break;
      }

      while (this.running < this.concurrency && !this.stopped && !this.immediateStop) {
        let data;

        try {
          data = await this.getNextItem();
        } catch (err) {
          this.hooks.onGetItemError?.(err);
          this.immediateStop = true;
          this._rejectAll();
          break;
        }

        if (data === null || data === undefined) break;

        const key = this._nextKey++;

        if (this.delay > 0) {
          this.hooks.onDelay?.(key, data, this.delay);
          await this._wait(this.delay);
        }

        const controller = new AbortController();
        const signal = controller.signal;
        this.abortControllers.set(key, controller);
        this.running++;

        this.hooks.onStart?.(key, data);

        this._runTask(key, data, signal)
          .finally(() => {
            this.abortControllers.delete(key);
            this.running--;
            this._checkFinish();
          });
      }

      await this._wait(50);
    }

    this._isLooping = false;
  }

  async _runTask(key, data, signal) {
    try {
      const result = await this._attemptRun(key, data, signal);
      this.results[key] = result;
      this.hooks.onFinish?.(key, data, result);
    } catch (err) {
      this.totalErrors++;
      this.results[key] = { error: err };

      const type = this._isAbortError(err) || signal.aborted || this.immediateStop
        ? 'stopped'
        : 'error';

      this.hooks.onError?.(key, data, err, type);

      if (this.totalErrors >= this.maxTotalErrors) {
        this.immediateStop = true;
        this.hooks.onMaxTotalErrors?.(this.totalErrors, this.maxTotalErrors);
        this._checkFinish();
      }
    }
  }

  _checkFinish() {
    if (this.running === 0 && this.immediateStop && !this.resolved) {
      this.resolved = true;
      this._rejectAll();
    }
  }

  async start() {
    if (this.resolved || this.immediateStop) return this.result;
    this._loop();
    return this.result;
  }

  stop(immediate = false) {
    if (this.resolved) return;

    if (immediate) {
      this.immediateStop = true;

      for (const controller of this.abortControllers.values()) {
        controller.abort();
      }
      this.abortControllers.clear();

      this._checkFinish();
    } else {
      this.stopped = true;
      this.hooks.onPause?.();
    }
  }

  resume() {
    if (!this.stopped || this.resolved || this.immediateStop) return;

    this.stopped = false;
    this.hooks.onResume?.();

    const waiters = [...this.waiters];
    this.waiters = [];
    waiters.forEach((resume) => resume());

    this._loop();
  }
}

module.exports = {
  PromiseProcessor,
  StreamingPromiseProcessor
};
