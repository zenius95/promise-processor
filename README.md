# promise-processor

**`promise-processor`** is a lightweight utility class for handling a batch of asynchronous tasks (Promises) with powerful features such as:

* 🔁 Concurrency control
* ⏳ Delays between tasks
* 🕐 Timeout per task
* 🔁 Automatic retries
* ⏸️ Pause / ▶️ Resume / 🛑 Stop support
* 📡 Lifecycle hooks for monitoring task execution

---

## 📦 Installation

```bash
# Import it into your project
npm i promise-processor
```

---

## 🚀 Basic Usage

```js
const mockApiCall = async (user) => {
  // Simulate a slow API call
  await new Promise(res => setTimeout(res, Math.random() * 1000));
  if (Math.random() < 0.2) throw new Error("API error");
  return `Welcome ${user.name}`;
};

const users = [
  { name: "Alice" },
  { name: "Bob" },
  { name: "Charlie" },
  { name: "Diana" }
];

const processor = new PromiseProcessor(
  mockApiCall,
  users,
  {
    concurrency: 2,
    delay: 200,
    timeout: 1500,
    retryDelay: 500,
    maxRetries: 1,
    maxTotalErrors: 3,

    // Hooks
    onStart: (key, item) => console.log(`🔄 Starting [${key}] ${item.name}`),
    onFinish: (key, item, result) => console.log(`✅ Done [${key}]: ${result}`),
    onError: (key, item, err) => console.log(`❌ Failed [${key}]: ${err.message}`),
    onRetry: (key, item, attempt, err) =>
      console.log(`🔁 Retry [${key}] attempt ${attempt}: ${err.message}`),
    onTimeout: (key, item, err) =>
      console.log(`⏱️ Timeout [${key}]: ${item.name}`),
    onPause: () => console.log("⏸️ Processing paused"),
    onResume: () => console.log("▶️ Processing resumed"),
    onDelay: (key, item, delay) =>
      console.log(`⏳ Delaying ${delay}ms before [${key}]`)
  }
);

// Start processing
processor.start()
  .then(results => {
    console.log("🎉 All tasks complete:", results);
  })
  .catch(err => {
    console.error("🔥 Processor stopped:", err.message);
  });
```

---

## ⚙️ Options

| Option           | Type                              | Default     | Description                                  |
| ---------------- | --------------------------------- | ----------- | -------------------------------------------- |
| `concurrency`    | `number`                          | `1`         | Maximum number of parallel tasks             |
| `delay`          | `number` (ms)                     | `0`         | Delay between task executions                |
| `timeout`        | `number` (ms)                     | `0`         | Max time allowed per task                    |
| `retryDelay`     | `number` (ms)                     | `0`         | Delay between retry attempts                 |
| `maxRetries`     | `number` or `function(item, key)` | `0`         | Max retry attempts per task                  |
| `maxTotalErrors` | `number`                          | `Infinity`  | Max total failures before aborting all tasks |

---

## 🪝 Lifecycle Hooks

| Hook                                 | Description                         |
| ------------------------------------ | ----------------------------------- |
| `onStart(key, item)`                 | Called before a task starts         |
| `onFinish(key, item, result)`        | Called when a task succeeds         |
| `onError(key, item, error)`          | Called when a task fails            |
| `onRetry(key, item, attempt, error)` | Called before a retry               |
| `onTimeout(key, item, error)`        | Called on task timeout              |
| `onPause()`                          | Called when processing is paused    |
| `onResume()`                         | Called when processing resumes      |
| `onDelay(key, item, delay)`          | Called before a delay between tasks |

---

## 📘 API Methods

### `start(): Promise<results[]>`

Start processing all items. Resolves with an array of results (same order as input).

### `stop(immediate = false)`

* If `false`: pauses the processor, can be resumed later.
* If `true`: immediately stops all tasks and rejects the main promise.

### `resume()`

Resumes processing if it was previously paused.

---

## 🧪 Output Example

```js
[
  "Welcome Alice",
  { error: Error("API error") },
  "Welcome Charlie",
  "Welcome Diana"
]
```