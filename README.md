# @360works/fmpromise

A modern JavaScript toolkit for FileMaker Web Viewers. `fmPromise` bridges the gap between FileMaker and modern web development with a promise-based API, a live-reloading dev server, and a powerful, type-safe wrapper for the FileMaker Data
API. In addition, fmPromise provides a means for converting multi-file html apps to single-file, minified html payloads which can be stored in your database and easily deployed.

Instead of callback-based JavaScript, `fmPromise` methods return a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) for cleaner, more modern code.

Add in the syntactic sugar of [async/await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) and you can have this:

```js
const records = (await fmPromise.executeFileMakerDataAPI({
	action: 'read',
	layouts: 'Users',
	query: [{status: 'active'}]
})).toRecords();

console.log(`Found ${records.foundCount} records.`);
const firstUser = records[0];
console.log(firstUser.firstName);
```

In addition, fmPromise offers more convenient data structures for returned values. 

`fmPromise.executeSQL` return an array of arrays, instead of a string, and supports safe inlining of parameters. 

`fmPromise.executeFileMakerDataAPI({...}).toRecords()`  returns an array of objects, with portal data arrays as attributes.

# Using fmPromise

**Install the fmPromise Add-On**

You can [download the fmPromise Add-On here](https://store.360works.com/add-product/FMPROMISE):

https://store.360works.com/add-product/FMPROMISE

Restart FileMaker

Add this to your FileMaker solution's add-ons. 

Drag an fmPromise module to your FileMaker layout, enter Browser mode, and follow the instructions there.

# API

`fmPromise.performScript(scriptName, parameter)` Performs a FileMaker script, returning a Promise. The Promise will be resolved with the script result (parsed as JSON if possible), or rejected if the FileMaker script result starts with the
word "ERROR".

`fmPromise.evaluate(expression, letVars)` Evaluate an expression in FileMaker using optional letVars. This is also a handy way to set $$GLOBAL variables.

```fmPromise.executeSql`select id, name from Team where color=${color}` ``` Performs an SQL query, returning results as an array of array. Embedded variables like `${color}` are parameterized safely using this method.

`fmPromise.executeFileMakerDataAPIRecords({layouts:'Team', limit:2})` Execute the data API, returning an array of Objects. Each object in the resulting array will have non-enumerable `recordId` and `modid` attributes. `portalData` arrays for each record will be inlined with other attributes, using the portal table name as the key.

# Additional benefits

* FileMaker worker scripts don't need to know anything about your web viewers, they simply exit with a (preferably JSON) result.
* FileMaker Scripts can return an "Error …" result, which will be used to reject the script call's promise.
* Each FileMaker script call has an id, so you can fire off multiple script calls to FileMaker and they will resolve correctly. Generally one-at-a-time execution, given FileMaker's single-threaded nature.
* You can make script calls as soon as your `<script type="module">` tag finishes loading, since `fmPromise` takes care of polling for the `window.FileMaker` object.


# Debugging

I would *strongly* recommend you enable external JavaScript debugging in your web viewer, as described [here](https://community.claris.com/en/s/question/0D50H00007uvYTVSA2/enable-inspect-element-with-right-click-in-webviewer-).

From your terminal, type:

```bash
defaults write com.FileMaker.client.pro12 WebKitDebugDeveloperExtrasEnabled -bool YES
```

This allows you to utilize Safari's developer tools on your web viewer code, which is incredibly useful.
