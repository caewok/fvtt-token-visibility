/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/* Example converting asynchronous callback function to use async/await

function callbackBasedFunction(arg1, arg2, callback) {
  // Simulate asynchronous operation
  setTimeout(() => {
    if ( arg1 + arg2 > 5) callback(null, arg1 + arg2); // Simulate success
    else callback("Error: Sum is not greater than 5.");
  }, 500);
}

function promiseBasedFunction(arg1, arg2) {
  return new Promise((resolve, reject) => {
    callbackBasedFunction(arg1, arg2, (err, result) => {
      if ( err ) reject(err);
      else resolve(result);
    });
  });
}

// Example usage:
async function callAsyncFunction() {
  try {
    return await promiseBasedFunction(3, 4);
  } catch ( error ) {
    console.error("Error:", error)
  }
}

*/

// requestAnimationFrame does not follow (resolve, reject) so customize.
async function requestAnimationFrameAsync() {
  return new Promise((resolve, _reject) => {
    requestAnimationFrame(ms => resolve(ms));
  });
}

// Is this version necessary as compared to asPromise?
export async function asPromiseNoArgs(callbackFunction) {
  return new Promise((resolve, reject) => {
    callbackFunction((err, result) => {
      if ( err ) reject(err);
      else resolve(result);
    });
  });
}


export async function asPromise(callbackFunction, ...args) {
  return new Promise((resolve, reject) => {
    callbackFunction(...args, (err, result) => {
      if ( err ) reject(err);
      else resolve(result);
    });
  });
}

export async function asPromiseWithContext(context, callbackFunction, ...args) {
  return new Promise((resolve, reject) => {
    callbackFunction.call(context, ...args, (err, result) => {
      if ( err ) reject(err);
      else resolve(result);
    });
  });
}

/* Test
function callbackBasedFunction(arg1, arg2, callback) {
  // Simulate asynchronous operation
  setTimeout(() => {
    if ( arg1 + arg2 > 5) callback(null, arg1 + arg2); // Simulate success
    else callback("Error: Sum is not greater than 5.");
  }, 500);
}

await asPromise(callbackBasedFunction, 3, 5)
await asPromise(callbackBasedFunction, 3, 1)

// Using requestAnimationFrame

t0 = performance.now();
await asPromise(requestAnimationFrame);
t1 = performance.now();
console.log(`Frame 0: ${t1 - t0} ms`)
await asPromise(requestAnimationFrame);
t2 = performance.now();
console.log(`Frame 1: ${t2 - t1} ms`)



*/

// See query discussion in https://www.realtimerendering.com/blog/webgl-2-new-features/

export async function retrieveQueryResult(gl, query) {
  // A query's result is never available in the same frame the query was issued. Try in the next frame.
  while ( gl.isQuery(query) && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) ) await requestAnimationFrameAsync();
  const samplesPassed = gl.getQueryParameter(query, gl.QUERY_RESULT);
  try { gl.deleteQuery(query); } catch (err) { console.error(err); }
  return samplesPassed;
}
