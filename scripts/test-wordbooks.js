const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const storage = new Map();
const ctx = vm.createContext({ console, URL, URLSearchParams, setTimeout,
  document:{getElementById:()=>({value:''})},
  location: {hostname:'localhost',protocol:'file:'}, navigator:{},
  window:{clearTimeout, setTimeout},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
});
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/boot\(\);\s*$/, ''),ctx);
ctx.seed = JSON.parse(fs.readFileSync(path.join(root,'data/words.json'),'utf8'));
vm.runInContext(`
baseWords=seed;
token='test-only-not-a-real-token';
var requests=[];
var mockRow={progress:{},custom_words:[],base_words:[]};
supabaseRequest=async (url,options)=>{requests.push({url,options}); return [mockRow];};
saveLocal=()=>{}; setAuthVisible=()=>{}; renderAuthMode=()=>{}; render=()=>{};
`,ctx);
(async()=>{
  await vm.runInContext(`enterCloudSession({id:'3ff1ca0c-acfa-4698-95b5-5573890b5292',email:'steven.xu@porteasy.cn'})`,ctx);
  vm.runInContext(`mockRow={progress:{kept:{seen:4}},custom_words:[],base_words:null}`,ctx);
  await vm.runInContext(`enterCloudSession({id:'3ff1ca0c-acfa-4698-95b5-5573890b5292',email:'steven.xu@porteasy.cn'})`,ctx);
  assert.equal(vm.runInContext('words.length',ctx),82);
  assert.equal(vm.runInContext('progress.kept.seen',ctx),4);
  assert.equal(vm.runInContext('requests.at(-1).options.body.base_words.length',ctx),82);
  storage.set('youdao-word-memory-progress-v1:zeran.xu@icloud.com','{"stale":{"seen":99}}');
  storage.set('word-memory-local-words-v2:zeran.xu@icloud.com','[{"word":"stale"}]');
  vm.runInContext(`mockRow={progress:{},custom_words:[],base_words:[]}`,ctx);
  await vm.runInContext(`enterCloudSession({id:'b39fdeec-0b83-4f05-a9e5-5f2375bb8440',email:'zeran.xu@icloud.com'})`,ctx);
  assert.equal(vm.runInContext('words.length',ctx),0);
  assert.equal(vm.runInContext('Object.keys(progress).length',ctx),0);
  assert.match(vm.runInContext('requests.at(-1).url',ctx),/wordbook_zeran/);
  vm.runInContext(`customWords=[{word:'apple',id:'custom-apple'}]; rebuildWords(); prepareProgress();`,ctx);
  await vm.runInContext('writeCloudData()',ctx);
  assert.equal(vm.runInContext('words.length',ctx),1);
  assert.equal(vm.runInContext('requests.at(-1).options.body.custom_words[0].word',ctx),'apple');
  vm.runInContext('mockRow=null',ctx);
  await assert.rejects(vm.runInContext(`enterCloudSession({id:'b39fdeec-0b83-4f05-a9e5-5f2375bb8440',email:'zeran.xu@icloud.com'})`,ctx),/迁移/);
  console.log('PASS: Steven preserved; Zerán empty; stale cache ignored; imports isolated; missing rows fail closed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
