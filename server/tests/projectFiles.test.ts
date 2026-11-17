import test from 'node:test'
import assert from 'node:assert/strict'
import { validExtraFilePath, validateExtraFiles } from '../src/projectFiles.js'

test('accepts legitimate full-stack source files', () => {
  for (const path of ['server.js','package.json','server/db.js','src/routes/appointments.ts','tests/appointments.test.js','.env.example','README.md','schema.sql','server/.env.example']) {
    assert.equal(validExtraFilePath(path), true, path)
  }
})
test('rejects traversal, secret paths and protected frontend files', () => {
  for (const path of ['../evil.js','/tmp/evil.js','..\\evil.js','server/../../evil.js','C:/x.js','.env','server/.env','server/.env.local','secret.pem','index.html','styles.css','script.js','node_modules/pkg.js','__proto__/a.js']) {
    assert.equal(validExtraFilePath(path), false, path)
  }
})
test('rejects unsafe or oversized project manifest', () => {
  assert.match(validateExtraFiles({'../../evil.js':'bad'}) || '', /unsafe/)
  assert.match(validateExtraFiles({'server.js':'x'.repeat(180001)}) || '', /size/)
  assert.equal(validateExtraFiles({'server.js':'const express = require("express")','package.json':'{}'}),null)
  const many: Record<string,string> = {}
  for (let i=0;i<31;i++) many[`src/file${i}.js`]='ok'
  assert.match(validateExtraFiles(many) || '', /Too many/)
})
