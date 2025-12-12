/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

export class AsyncQueue {
  /** @type {boolean} */
  isRunning = false;

  /** @type {function} */
  queue = [];

  /**
   * Add a function to the task. The function should be async.
   * If a promise is passed, the promise will be awaited.
   * @param {function|Promise} task
   */
  enqueue(task) {
    this.queue.push(task);
    if ( !this.isRunning ) this.processNext();
  }

  async processNext() {
    if ( !this.queue.length ) {
      this.isRunning = false;
      return;
    }
    this.isRunning = true;
    const task = this.queue.shift();
    try {
      if ( task instanceof Promise ) await task;
      else await task();
    } catch ( err ) {
      console.error("AsyncQueue|task failed:", err);
    } finally {
      this.processNext();
    }
  }
}

/* Example usage
queue = new AsyncQueue();

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

task1 = async () => {
  console.log("Task 1 started.");
  await sleep(1000);
  console.log("Task 1 completed");
}

a = "hello";
task2 = async () => {
  console.log(`Task 2 started. ${a}`);
  await sleep(500);
  console.log("Task 2 completed");
}

queue.enqueue(task1)
queue.enqueue(task2)

*/


