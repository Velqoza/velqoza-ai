import test from 'node:test'
import assert from 'node:assert/strict'
import {CHECKOUT_PAYMENT_CSP} from '../src/checkoutCsp.js'

test('PayPal v6 checkout CSP permits production and sandbox card scripts and frames',()=>{
  const directives=Object.fromEntries(CHECKOUT_PAYMENT_CSP.split('; ').map(x=>{
    const [name,...values]=x.split(' ')
    return [name,values]
  })) as Record<string,string[]>
  for(const directive of ['script-src','frame-src','connect-src','img-src']){
    assert.ok(directives[directive].includes('https://*.paypal.com'),directive+' must allow PayPal hosts')
  }
  assert.ok(directives['script-src'].includes('https://*.paypalobjects.com'))
  assert.ok(directives['frame-src'].includes('https://*.paypalobjects.com'))
  assert.ok(directives['connect-src'].includes('https://*.paypalobjects.com'))
  assert.deepEqual(directives['default-src'],["'self'"])
  assert.deepEqual(directives['object-src'],["'none'"])
  assert.ok(!CHECKOUT_PAYMENT_CSP.includes("'unsafe-eval'"))
  assert.ok(!CHECKOUT_PAYMENT_CSP.includes('https://pay.google.com'))
  assert.ok(!CHECKOUT_PAYMENT_CSP.includes('https:;'))
})
