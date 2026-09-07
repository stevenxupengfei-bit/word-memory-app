const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const noop = () => {};
const element = { value: '', textContent: '', innerHTML: '', classList: { add: noop, remove: noop, toggle: noop } };
const ctx = vm.createContext({
  console, setTimeout, clearTimeout,
  location: { hostname: 'localhost', protocol: 'file:' }, navigator: {},
  window: { setTimeout, clearTimeout }, localStorage: { getItem: () => null, setItem: noop },
  document: { getElementById: () => element, querySelectorAll: () => [] },
});
const source = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8').replace(/boot\(\);\s*$/, '');
vm.runInContext(source, ctx);
vm.runInContext(`
words=[{id:'a',word:'a',definition:'A'},{id:'b',word:'b',definition:'B'},{id:'c',word:'c',definition:'C'}];
progress={a:freshProgress(),b:freshProgress(),c:freshProgress()};
filter='all'; currentId='a'; save=()=>{}; render=()=>{}; focusCurrentListPage=()=>{}; resetQuizFeedback=()=>{};
`, ctx);

vm.runInContext(`grade('good')`, ctx);
assert.equal(vm.runInContext('currentId', ctx), 'b', 'a should advance to b');
vm.runInContext(`grade('good')`, ctx);
assert.equal(vm.runInContext('currentId', ctx), 'c', 'b should advance to c, not loop to a');
const before = Date.now();
vm.runInContext(`grade('hard')`, ctx);
const dueAt = vm.runInContext('progress.c.dueAt', ctx);
assert.ok(dueAt >= before + 11.9 * 60 * 60 * 1000, 'hard review should wait about 12 hours');
vm.runInContext(`progress.a.misses=2; progress.a.streak=2; progress.a.lastGrade='good'; filter='weak'`, ctx);
assert.equal(vm.runInContext(`weakWords().some(w=>w.id==='a')`, ctx), false, 'recovered word should leave weak queue');
console.log('PASS: review advances A -> B -> C; hard waits 12 hours; recovered words leave weak queue.');
