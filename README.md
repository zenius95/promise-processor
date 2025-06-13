README.md đã được cập nhật với phần mô tả và ví dụ sử dụng cho tính năng `maxTotalErrors`. Nếu bạn muốn mình tạo bản sao markdown đầy đủ hoặc xuất file, chỉ cần nói nhé bro!

Dưới đây là nội dung `README.md` đầy đủ dành cho class `PromiseProcessor` bạn đã cung cấp:

---

````markdown
# PromiseProcessor

A lightweight and extensible utility to manage asynchronous tasks with advanced control over concurrency, delays, timeouts, retries, and graceful shutdown.

## Features

- Run asynchronous tasks with configurable concurrency
- Delay between task starts
- Retry failed tasks with delay
- Timeout individual tasks
- Stop immediately or after current tasks finish
- Pause and resume processing
- Limit maximum number of total errors
- Event hooks for task lifecycle events

## Installation

```bash
npm install promise-processor
````

## Usage

```js
const PromiseProcessor = require('promise-processor');

// Simulate async task
const fakeApi = async (item) => {
  await new Promise((res) => setTimeout(res, 500 + Math.random() * 1000));
  if (Math.random() < 0.3) throw new Error("Random error");
  return `Result for ${item}`;
};

const items = ["task1", "task2", "task3", "task4", "task5", "task6"];

const processor = new PromiseProcessor(fakeApi, items, {
  delay: 200,
  concurrency: 2,
  timeout: 1000,
  maxRetries: 2,
  retryDelay: 300,
  maxTotalErrors: 3,
  onStart: (key, item) => console.log(`Start: ${key}`, item),
  onFinish: (key, item, result) => console.log(`Finish: ${key}`, result),
  onError: (key, item, error) => console.error(`Error: ${key}`, error.message),
  onRetry: (key, item, attempt, error) =>
    console.log(`Retry: ${key} attempt ${attempt}`, error.message),
  onTimeout: (key, item, error) => console.warn(`Timeout: ${key}`, error.message),
  onPause: (data) => console.log("Paused"),
  onResume: (data) => console.log("Resumed"),
});

(async () => {
  processor.start();

  // Pause after 2s
  setTimeout(() => processor.stop(), 2000);

  // Resume after 4s
  setTimeout(() => processor.resume(), 4000);

  try {
    const results = await processor.result;
    console.log("All done:", results);
  } catch (err) {
    console.error("Processing stopped with error:", err.message);
  }
})();
```

## API

### Constructor

```js
new PromiseProcessor(promiseHandler, dataArray, options)
```

-   `promiseHandler`: an async function to handle each item

-   `dataArray`: array of data to process

-   `options`: configuration options (see below)


### Options

| Option | Type | Description |
| --- | --- | --- |
| `delay` | `number` | Delay (ms) between task starts |
| `concurrency` | `number` | Max number of concurrent tasks |
| `timeout` | `number` | Timeout (ms) for each task |
| `maxRetries` | `number` |Max retry attempts per task|
| `retryDelay` | `number` | Delay between retries |
| `maxTotalErrors` | `number` | Abort all if total errors reach this number |
| `onStart` | `(key, item) => void` | Called when a task starts |
| `onFinish` | `(key, item, result) => void` | Called on successful completion |
| `onError` | `(key, item, error) => void` | Called when a task fails after retries |
| `onRetry` | `(key, item, attempt, error) => void` | Called on retry |
| `onTimeout` | `(key, item, error) => void` | Called when a task times out |
| `onPause` | `(dataArray) => void` | Called when paused |
| `onResume` | `(dataArray) => void` | Called when resumed |

### Methods

#### `start()`

Begin processing tasks. Returns immediately; the final result is exposed via the `result` promise.

#### `stop(immediate = false)`

Stop processing.

-   `immediate = true`: stops immediately, cancels further processing

-   `immediate = false`: lets current tasks finish, then halts


#### `resume()`

Resume after a `stop()` (graceful pause).

#### `result`

Promise that resolves with final results array or rejects on fatal error or immediate stop.