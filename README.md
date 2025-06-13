# PromiseProcessor

A flexible and powerful utility for managing concurrent async tasks (Promises) with controlled concurrency, delay, retries, timeout, and lifecycle hooks.

## Features

-   Limit number of concurrent promises

-   Delay between each new promise

-   Retry failed promises with optional delay

-   Timeout handling

-   Pause, resume, and stop control

-   Lifecycle hooks: onStart, onFinish, onError, onRetry, onPause, onResume, onTimeout

-   Supports array input


## Installation

```bash
npm install promise-processor
```

## Usage

### Example with Array Input

```js
const PromiseProcessor = require("promise-processor");

// Simulated API call
const fakeApi = async (item) => {
  const delay = Math.floor(Math.random() * 3000);
  await new Promise((res) => setTimeout(res, delay));
  if (Math.random() < 0.2) throw new Error("Random failure");
  return `Processed ${item.name}`;
};

const dataArray = [
  { name: "Task One" },
  { name: "Task Two" },
  { name: "Task Three" },
  { name: "Task Four" },
  { name: "Task Five" },
  { name: "Task Six" },
];

const processor = new PromiseProcessor(fakeApi, dataArray, 200, 3, {
  timeout: 2500,
  maxRetries: 2,
  retryDelay: 300,
  maxTotalErrors: 3,
  onStart: (key, item) => console.log(`🟡 Starting ${key}: ${item.name}`),
  onFinish: (key, item, result) => console.log(`🟢 Finished ${key}: ${result}`),
  onError: (key, item, error) => console.error(`🔴 Error ${key}:`, error.message),
  onRetry: (key, item, attempt, err) => console.log(`🔁 Retry ${key} (attempt ${attempt})`),
  onPause: (data) => console.log("⏸️ Paused"),
  onResume: (data) => console.log("▶️ Resumed"),
  onTimeout: (key, item, error) => console.warn(`⏱️ Timeout ${key}: ${item.name}`)
});

(async () => {
  await processor.start();

  setTimeout(() => processor.stop(), 2000); // Pause after 2 seconds
  setTimeout(() => processor.resume(), 4000); // Resume after 4 seconds

  const results = await processor.result;
  console.log("✅ All results:", results);
})();
```

## API

### Constructor

```ts
new PromiseProcessor(handler, dataArray, delayMS, concurrency, options)
```

-   `handler(item)`: async function to handle each item

-   `dataArray`: an array of data items

-   `delayMS`: delay between task starts (ms)

-   `concurrency`: max number of concurrent tasks

-   `options`: additional config


### Options

| Name | Type | Description |
| --- | --- | --- |
| `timeout` | `number` | Timeout for each task (ms) |
| `maxRetries` | `number | (item, key) => number` | Number of retry attempts |
| `retryDelay` | `number` | Delay before retry (ms) |
| `maxTotalErrors` | `number` | Max number of errors before aborting |
| `onStart` | `(key, item) => void` | Called when a task starts |
| `onFinish` | `(key, item, result) => void` | Called when a task finishes successfully |
| `onError` | `(key, item, error) => void` | Called when a task fails permanently |
| `onRetry` | `(key, item, attempt, error) => void` | Called on each retry |
| `onPause` | `(dataArray) => void` | Called when processor is paused |
| `onResume` | `(dataArray) => void` | Called when processor resumes |
| `onTimeout` | `(key, item, error) => void` | Called when a task times out |

### Methods

#### `start()`

Starts the task processing.

#### `stop(immediate = false)`

Stops the processor.

-   `immediate = true`: immediately abort all tasks and reject

-   `immediate = false`: allow current tasks to finish


#### `resume()`

Resumes processing if previously paused.

#### `result`

A Promise that resolves when all tasks are completed or rejects if aborted or errors exceeded.