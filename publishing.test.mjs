import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const publishScript=fileURLToPath(new URL('./.github/publish.sh',import.meta.url));
const bash=process.platform==='win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
  ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const generatedFiles=['football.ics','state.json','status.json'];
const generator=`import {readFileSync,writeFileSync} from 'node:fs';
const {value}=JSON.parse(readFileSync('config.json','utf8'));
for(const file of ${JSON.stringify(generatedFiles)}) writeFileSync(file,value+'\\n');
`;

function run(command,args,cwd,{allowFailure=false}={}) {
  const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:60000,windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'}});
  assert.ifError(result.error);
  if(!allowFailure) assert.equal(result.status,0,`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}
const git=(cwd,...args)=>run('git',args,cwd).stdout.trim();

function fixture(t) {
  const tempParent=realpathSync(tmpdir());
  const root=mkdtempSync(path.join(tempParent,'football-publish-test-'));
  t.after(()=>{
    const resolved=realpathSync(root);
    assert.equal(path.dirname(resolved),tempParent,'Cleanup must stay directly under the temporary directory');
    assert.ok(path.basename(resolved).startsWith('football-publish-test-'));
    rmSync(resolved,{recursive:true,force:true});
  });
  const remote=path.join(root,'remote.git');
  const editor=path.join(root,'editor');
  const publisher=path.join(root,'publisher');
  git(root,'init','--bare','--initial-branch=main',remote);
  git(root,'clone',remote,editor);
  const configure=repo=>{
    git(repo,'config','user.name','Calendar publishing test');
    git(repo,'config','user.email','calendar-test@example.invalid');
    git(repo,'config','commit.gpgsign','false');
    git(repo,'config','core.autocrlf','false');
  };
  configure(editor);
  writeFileSync(path.join(editor,'config.json'),JSON.stringify({value:'initial'}));
  writeFileSync(path.join(editor,'generate.mjs'),generator);
  writeFileSync(path.join(editor,'fixture.test.mjs'),"import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fixture check',()=>assert.equal(1,1));\n");
  for(const file of generatedFiles) writeFileSync(path.join(editor,file),'previous publication\n');
  git(editor,'add','.');
  git(editor,'commit','-m','Initial fixture');
  git(editor,'push','origin','main');
  git(root,'clone',remote,publisher);
  configure(publisher);
  return {root,remote,editor,publisher};
}

function publish(publisher) {
  return run(bash,[publishScript.replaceAll('\\','/')],publisher,{allowFailure:true});
}

test('a stale publisher preserves the newer source commit and regenerates from its configuration',t=>{
  const {remote,editor,publisher}=fixture(t);
  run(process.execPath,['generate.mjs'],publisher);
  writeFileSync(path.join(editor,'config.json'),JSON.stringify({value:'updated configuration'}));
  writeFileSync(path.join(editor,'source-change.txt'),'This independent edit must survive.\n');
  git(editor,'add','config.json','source-change.txt');
  git(editor,'commit','-m','Change configuration while generation is in flight');
  git(editor,'push','origin','main');
  const newerSource=git(remote,'rev-parse','main');

  const result=publish(publisher);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  const published=git(remote,'rev-parse','main');
  assert.notEqual(published,newerSource);
  git(remote,'merge-base','--is-ancestor',newerSource,published);
  assert.equal(git(remote,'show','main:source-change.txt'),'This independent edit must survive.');
  assert.deepEqual(JSON.parse(git(remote,'show','main:config.json')),{value:'updated configuration'});
  for(const file of generatedFiles) assert.equal(git(remote,'show',`main:${file}`),'updated configuration');
  assert.deepEqual(git(remote,'diff-tree','--no-commit-id','--name-only','-r',published).split('\n').sort(),generatedFiles.toSorted());
});

test('a push rejected without an advancing remote is reported as a failure',t=>{
  const {remote,publisher}=fixture(t);
  const before=git(remote,'rev-parse','main');
  const hook=path.join(remote,'hooks','pre-receive');
  writeFileSync(hook,'#!/bin/sh\necho "Publication deliberately denied" >&2\nexit 1\n');
  chmodSync(hook,0o755);
  run(process.execPath,['generate.mjs'],publisher);

  const result=publish(publisher);
  assert.notEqual(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr,/Publication deliberately denied/);
  assert.equal(git(remote,'rev-parse','main'),before);
  assert.equal(git(remote,'show','main:football.ics'),'previous publication');
});

test('unchanged generated files do not create or publish a commit',t=>{
  const {remote,publisher}=fixture(t);
  const before=git(remote,'rev-parse','main');
  const result=publish(publisher);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.equal(git(remote,'rev-parse','main'),before);
  assert.equal(git(publisher,'rev-parse','HEAD'),before);
  assert.equal(git(publisher,'status','--porcelain'),'');
});
