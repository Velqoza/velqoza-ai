import test from 'node:test'
import assert from 'node:assert/strict'
import { aiModelField, advancedModelsEnabled, resolveOpenAIModel, modelCatalog, makeAdvancedModelLimiter } from '../src/modelSelection.js'

const env = {
  OPENAI_API_KEY: 'fake-key-for-unit-tests',
  OPENAI_MODELS_ENABLED: 'true',
  OPENAI_MODEL: 'gpt-6.1-terra',
  OPENAI_DAILY_LIMIT: '2',
  OPENAI_PER_IP_DAILY_LIMIT: '1'
}

test('only explicitly listed AI model choices are allowed',()=>{
  assert.equal(aiModelField.parse(undefined),'default')
  assert.equal(aiModelField.parse('gpt-6.1-sol'),'gpt-6.1-sol')
  assert.equal(aiModelField.parse('gpt-6-astra'),'gpt-6-astra')
  assert.equal(aiModelField.safeParse('gpt-6.2-astra').success,false)
  assert.equal(aiModelField.safeParse('gpt-6.2-sol').success,false)
  assert.equal(aiModelField.safeParse('some-other-model').success,false)
})

test('default model is preserved while Sol/Astra require explicit enablement',()=>{
  assert.equal(resolveOpenAIModel('default', env),'gpt-6.1-terra')
  assert.equal(resolveOpenAIModel('gpt-6.1-sol', env),'gpt-6.1-sol')
  assert.equal(resolveOpenAIModel('gpt-6-astra', env),'gpt-6-astra')
  assert.equal(modelCatalog(env).length,3)
  assert.equal(advancedModelsEnabled({...env,OPENAI_MODELS_ENABLED:'false'}),false)
  assert.throws(()=>resolveOpenAIModel('gpt-6-astra',{...env,OPENAI_MODELS_ENABLED:'false'}),/not enabled/)
})

test('server daily limit applies per IP, per account, and globally',()=>{
  const accept=makeAdvancedModelLimiter(env)
  const today=new Date('2026-11-18T00:00:00Z')
  const tomorrow=new Date('2026-11-19T00:00:00Z')
  assert.deepEqual(accept('default','u1','ip1',today),{ok:true})
  assert.equal(accept('gpt-6.1-sol','u1','ip1',today).ok,true)
  assert.equal(accept('gpt-6.1-sol','u1','ip1',today).ok,false)
  assert.equal(accept('gpt-6-astra','u2','ip2',today).ok,true)
  assert.equal(accept('gpt-6-astra','u3','ip3',today).ok,false)
  assert.equal(accept('gpt-6-astra','u1','ip1',tomorrow).ok,true)
})
