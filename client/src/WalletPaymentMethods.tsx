import {useEffect,useRef,useState} from 'react'
import {api} from './api'

// Apple Pay is tokenized by its provider and PayPal.
// VELQOZA never receives or stores card numbers, CVVs, or Apple Pay tokens.
type PayPalSdk={
  findEligibleMethods:(input:{currencyCode:string;amount:string})=>Promise<{isEligible:(name:string)=>boolean}>
  createApplePayOneTimePaymentSession:()=>{config:()=>Promise<AppleConfig>;validateMerchant:(args:{validationUrl:string})=>Promise<{merchantSession:unknown}>;confirmOrder:(args:{orderId:string;token:unknown;billingContact?:unknown;shippingContact?:unknown})=>Promise<unknown>}
}
type AppleConfig={countryCode?:string;merchantCapabilities:string[];supportedNetworks:string[]}
type AppleSession={
  onvalidatemerchant:((event:{validationURL:string})=>void)|null
  onpaymentauthorized:((event:{payment:{token:unknown;billingContact?:unknown;shippingContact?:unknown}})=>void)|null
  oncancel:(()=>void)|null
  completeMerchantValidation:(data:unknown)=>void
  completePayment:(result:{status:number})=>void
  abort:()=>void
  begin:()=>void
}
type AppleSessionCtor={new(version:number,request:unknown):AppleSession;canMakePayments:()=>boolean;STATUS_SUCCESS:number;STATUS_FAILURE:number}
type WalletWindow=Window & {
  paypal?:{createInstance:(args:{clientToken?:string;clientId?:string;components:string[];pageType:string})=>Promise<PayPalSdk>}
  ApplePaySession?:AppleSessionCtor
}

let sdkPromise:Promise<void>|null=null
async function loadPayPalSdk(url:string){
  if(url!=='https://www.sandbox.paypal.com/web-sdk/v6/core')throw Error('Untrusted payment SDK source')
  if((window as WalletWindow).paypal?.createInstance)return
  if(!sdkPromise){
    sdkPromise=new Promise<void>((resolve,reject)=>{
      const script=document.createElement('script')
      script.src=url
      script.async=true
      script.onload=()=>resolve()
      script.onerror=()=>reject(Error('Unable to load secure Apple Pay provider'))
      document.head.append(script)
    }).catch(error=>{sdkPromise=null;throw error})
  }
  await sdkPromise
}

export function WalletPaymentMethods({requestId,amountCents,onSuccess}:{requestId:string;amountCents:number;onSuccess:(orderId:string)=>void}){
  const successRef=useRef(onSuccess)
  successRef.current=onSuccess
  const appleButtonRef=useRef<HTMLDivElement>(null)
  const [appleReady,setAppleReady]=useState(false)
  const [checking,setChecking]=useState(true)
  const [error,setError]=useState('')
  const price=(amountCents/100).toFixed(2)

  useEffect(()=>{
    let active=true
    const init=async()=>{
      try{
        // Wallet SDK is Sandbox-only; the backend refuses issuing its token in production.
        const settings=await api.cardFieldsToken()
        await loadPayPalSdk(settings.sdkUrl)
        if(!active)return
        const win=window as WalletWindow
        const sdk=await win.paypal!.createInstance({clientToken:settings.clientToken,components:['applepay-payments'],pageType:'checkout'})
        const eligible=await sdk.findEligibleMethods({currencyCode:'USD',amount:price})
        if(!active)return
        if(eligible.isEligible('applepay')&&win.ApplePaySession?.canMakePayments()){
          try{
            const provider=sdk.createApplePayOneTimePaymentSession()
            const config=await provider.config()
            if(active&&appleButtonRef.current){
              const button=document.createElement('button')
              button.type='button'
              button.textContent='Pay with Apple Pay'
              button.setAttribute('aria-label','Pay with Apple Pay')
              Object.assign(button.style,{width:'100%',padding:'15px',background:'#000',color:'#fff',border:'1px solid #777',borderRadius:'10px',fontWeight:'700',fontSize:'16px',cursor:'pointer'})
              button.addEventListener('click',()=>{
                setError('')
                try{
                  const appleCtor=win.ApplePaySession!
                  // An Apple Pay session must be created directly from a user gesture.
                  const native=new appleCtor(4,{
                    countryCode:config.countryCode||'US',currencyCode:'USD',
                    merchantCapabilities:config.merchantCapabilities,supportedNetworks:config.supportedNetworks,
                    requiredBillingContactFields:['postalAddress'],requiredShippingContactFields:[],
                    total:{label:'VELQOZA AI',amount:price,type:'final'}
                  })
                  native.onvalidatemerchant=event=>{
                    void provider.validateMerchant({validationUrl:event.validationURL})
                      .then(result=>native.completeMerchantValidation(result.merchantSession))
                      .catch(()=>{native.abort();setError('Apple Pay merchant validation failed. The checkout domain may need PayPal registration.')})
                  }
                  native.onpaymentauthorized=event=>{
                    void (async()=>{
                      try{
                        const order=await api.startCheckout(requestId,'applepay')
                        await provider.confirmOrder({orderId:order.orderId,token:event.payment.token,billingContact:event.payment.billingContact,shippingContact:event.payment.shippingContact})
                        await api.captureCheckout(order.orderId)
                        native.completePayment({status:appleCtor.STATUS_SUCCESS})
                        if(active)successRef.current(order.orderId)
                      }catch(err){
                        native.completePayment({status:appleCtor.STATUS_FAILURE})
                        if(active)setError(err instanceof Error?err.message:'Apple Pay could not confirm the payment.')
                      }
                    })()
                  }
                  native.oncancel=()=>{if(active)setError('Apple Pay was canceled.')}
                  native.begin()
                }catch(err){if(active)setError(err instanceof Error?err.message:'Apple Pay is not available on this device.')}
              })
              appleButtonRef.current.replaceChildren(button)
              setAppleReady(true)
            }
          }catch{/* Device or domain has not completed Apple Pay registration. */}
        }
      }catch(err){
        if(active)setError(err instanceof Error?err.message:'Apple Pay is unavailable.')
      }finally{if(active)setChecking(false)}
    }
    void init()
    return()=>{active=false}
  },[requestId,price])

  return <section style={{display:'grid',gap:10}}>
    <div ref={appleButtonRef} style={{display:appleReady?'block':'none'}}/>
    {checking&&<p role="status" style={{fontSize:12,color:'#aaa0c7',margin:0}}>Checking Apple Pay availability…</p>}
    {!checking&&!appleReady&&<p style={{fontSize:12,color:'#aaa0c7',margin:0}}>Apple Pay is not available on this browser/device or for this Sandbox merchant.</p>}
    {error&&<p role="alert" style={{color:'#ffc4ce',fontSize:12,margin:0}}>{error}</p>}
  </section>
}
