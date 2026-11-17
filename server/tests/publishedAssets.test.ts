import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPublishedDocument, publishedAsset } from '../src/publishedAssets.js'
import type { SiteCode } from '../src/types.js'

const eggside: SiteCode = {
  title: 'Eggside', description: 'Hatch, stock, sell.',
  html: '<link rel="stylesheet" href="phase2.css"><link rel="stylesheet" href="phase3.css"><div id="egg">EGGSIDE</div><script src="phase3.js"></script><script src="phase4.js"></script>',
  css: 'body{color:purple}', js: 'window.gameReady=true;',
  files: {
    'phase2.css': '.book{display:block}',
    'phase3.css': '.quests{display:block}',
    'phase3.js': 'window.questsReady=window.gameReady',
    'phase4.js': 'window.regionsReady=true',
    'server.js': 'PRIVATE SERVER SOURCE',
    'unused.js': 'PRIVATE UNUSED SOURCE'
  }
}

test('published HTML links base CSS before extra CSS and base JS before dependent JS', () => {
  const html=buildPublishedDocument(eggside,'index.html')
  assert.ok(html.indexOf('styles.css') < html.indexOf('phase2.css'))
  assert.ok(html.indexOf('phase2.css') < html.indexOf('phase3.css'))
  assert.ok(html.indexOf('script.js') < html.indexOf('phase3.js'))
  assert.ok(html.indexOf('phase3.js') < html.indexOf('phase4.js'))
  for(const filename of ['phase2.css','phase3.css','phase3.js','phase4.js']) {
    assert.equal(html.split(filename).length - 1, 1, filename+' not duplicated')
  }
  assert.ok(html.includes('<div id="egg">EGGSIDE</div>'))
})

test('only referenced additional frontend files are served, with correct MIME types', () => {
  assert.deepEqual(publishedAsset(eggside,'phase2.css'), {mime:'text/css',content:'.book{display:block}'})
  assert.deepEqual(publishedAsset(eggside,'phase3.js'), {mime:'application/javascript',content:'window.questsReady=window.gameReady'})
  assert.equal(publishedAsset(eggside,'unused.js'),null)
  assert.equal(publishedAsset(eggside,'server.js'),null)
  assert.equal(publishedAsset(eggside,'../../phase3.js'),null)
  assert.equal(publishedAsset(eggside,'notfound.css'),null)
})

test('full HTML documents retain language and external links while including game assets', () => {
  const site={...eggside,html:'<!doctype html><html><head><link rel="stylesheet" href="phase2.css"><link rel="preconnect" href="https://fonts.googleapis.com"></head><body><h1>Hi</h1><script src="phase3.js"></script></body></html>'}
  const html=buildPublishedDocument(site,'index.html')
  assert.match(html, /<html(?=[^>]*\blang="en")(?=[^>]*\bdir="ltr")[^>]*>/)
  assert.ok(html.includes('https://fonts.googleapis.com'))
  assert.ok(html.indexOf('styles.css') < html.indexOf('phase2.css'))
  assert.ok(html.indexOf('script.js') < html.indexOf('phase3.js'))
  assert.equal((html.match(/phase3.js/g)||[]).length,1)
})

test('published HTML handles pages object and optional files',()=>{
  const site={...eggside,files:undefined,pages:{'index.html':'<div>Welcome</div>','about.html':'<main>About</main>'}}
  assert.match(buildPublishedDocument(site,'about.html'),/<main>About<\/main>/)
  assert.equal(publishedAsset(site,'phase3.js'),null)
})
