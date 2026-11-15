import {useEffect,useRef,useState} from 'react'
import {api} from './api'

// PayPal and Google host and tokenize all wallet payment details.
// The application never receives or stores payment tokens, card numbers or CVVs.
type PayPalSdk={findEligibleMethods:(input:{currencyCode:string;amount:string})=>Promise<{isEligible:(name:string)=>boolean;getDetails:(name:string)=>{config:unknown}}>;
  createGooglePayOneTimePaymentSession:()=>{formatConfigForPaymentRequest:(config:unknown)=>GoogleConfig;confirmOrder:(args:{orderId:string;paymentMethodData:unknown})=>Promise<{status:string}>};
  createApplePayOneTimePaymentSession:()=>{config:()=>Promise<AppleConfig>;validateMerchant:(args:{validationUrl:string})=>Promise<{merchantSession:unknown}>;confirmOrder:(args:{orderId:string;token:unknown;billingContact?:unknown;shippingContact?:unknown})=>Promise<unknown>}}
type GoogleConfig={allowedPaymentMethods:unknown[];merchantInfo:unknown;apiVersion:number;apiVersionMinor:number;countryCode:string}
type AppleConfig={countryCode?:string;merchantCapabilities:string[];supportedNetworks:string[]}
type GoogleClient={isReadyToPay:(options:unknown)=>Promise<{result:boolean}>;createButton:(options:{onClick:()=>void})=>HTMLElement;loadPaymentData:(input:unknown)=>Promise<unknown>}
type AppleSession={onvalidatemerchant:((event:{validationURL:string})=>void)|null;onpaymentauthorized:((event:{payment:{token:unknown;billingContact?:unknown;shippingContact?:unknown}})=>void)|null;oncancel:(()=>void)|null;
  completeMerchantValidation:(data:unknown)=>void;completePayment:(result:{status:number})=>void;abort:()=>void;begin:()=>void}
type AppleSessionCtor={new(version:number,request:unknown):AppleSession;canMakePayments:()=>boolean;STATUS_SUCCESS:number;STATUS_FAILURE:number}
type WalletWindow=Window & {paypal?:{createInstance:(args:{clientToken:string;components:string[];pageType:string})=>Promise<PayPalSdk>};
  google?:{payments:{api:{PaymentsClient:new(args:unknown)=>GoogleClient}}};ApplePaySession?:AppleSessionCtor}
const sdkPromises=new Map<string,Promise<void>>()
async function loadSdk(url:string){
  if(!['https://www.sandbox.paypal.com/web-sdk/v6/core','https://pay.google.com/gp/p/js/pay.js'].includes(url))throw Error('Untrusted payment SDK source')
  if(url.includes('paypal.com')&&(window as WalletWindow).paypal?.createInstance)return
  if(url.includes('pay.google.com')&&(window as WalletWindow).google?.payments)return
  let promise=sdkPromises.get(url)
  if(!promise){
    promise=new Promise<void>((resolve,reject)=>{
      const script=document.createElement('script');script.src=url;script.async=true;
      script.onload=()=>resolve();script.onerror=()=>reject(Error('Unable to load secure wallet provider'))
      document.head.append(script)
    }).catch(error=>{sdkPromises.delete(url);throw error})
    sdkPromises.set(url,promise)
  }
  await promise
}
export function WalletPaymentMethods({requestId,amountCents,onSuccess}:{requestId:string;amountCents:number;onSuccess:(orderId:string)=>void}){
  const successRef=useRef(onSuccess)
  successRef.current=onSuccess
  const googleButtonRef=useRef<HTMLDivElement>(null)
  const appleButtonRef=useRef<HTMLDivElement>(null)
  const [googleReady,setGoogleReady]=useState(false)
  const [appleReady,setAppleReady]=useState(false)
  const [checking,setChecking]=useState(true)
  const [error,setError]=useState('')
  const price=(amountCents/100).toFixed(2)
  useEffect(()=>{
    let active=true
    const init=async()=>{
      try{
        // Wallet methods are disabled entirely on production; the endpoint
        // explicitly refuses to issue a Sandbox SDK configuration there.
        const settings=await api.cardFieldsToken()
        await loadSdk(settings.sdkUrl)
        if(!active)return
        const win=window as WalletWindow
        const sdk=await win.paypal!.createInstance({clientToken:settings.clientToken,components:['googlepay-payments','applepay-payments'],pageType:'checkout'})
        const eligible=await sdk.findEligibleMethods({currencyCode:'USD',amount:price})
        if(!active)return
        if(eligible.isEligible('googlepay')){
          try{
            await loadSdk('https://pay.google.com/gp/p/js/pay.js')
            if(!active)return
            const session=sdk.createGooglePayOneTimePaymentSession()
            const config=session.formatConfigForPaymentRequest(eligible.getDetails('googlepay').config)
            const client=new win.google!.payments.api.PaymentsClient({
              environment:'TEST',
              paymentDataCallbacks:{
                onPaymentAuthorized:async(paymentData:{paymentMethodData:unknown})=>{
                  try{
                    const order=await api.startCheckout(requestId,'googlepay')
                    const result=await session.confirmOrder({orderId:order.orderId,paymentMethodData:paymentData.paymentMethodData})
                    if(result.status==='PAYER_ACTION_REQUIRED')throw Error('Additional payer authentication is required; payment was not captured.')
                    if(!['APPROVED','COMPLETED'].includes(result.status))throw Error('Google Pay confirmation was not approved. No payment was captured.')
                    await api.captureCheckout(order.orderId)
                    if(active)successRef.current(order.orderId)
                    return {transactionState:'SUCCESS'}
                  }catch(err){
                    if(active)setError(err instanceof Error?err.message:'Google Pay could not confirm the payment.')
                    return {transactionState:'ERROR',error:{message:'Payment was not confirmed. Check your order status before retrying.'}}
                  }
                }
              }
            })
            const canPay=await client.isReadyToPay({apiVersion:config.apiVersion,apiVersionMinor:config.apiVersionMinor,allowedPaymentMethods:config.allowedPaymentMethods})
            if(active&&canPay.result&&googleButtonRef.current){
              const button=client.createButton({onClick:()=>{
                void client.loadPaymentData({
                  ...config,transactionInfo:{countryCode:config.countryCode,currencyCode:'USD',totalPriceStatus:'FINAL',totalPrice:price},
                  callbackIntents:['PAYMENT_AUTHORIZATION']
                }).catch((err:unknown)=>{if(active){const detail=err instanceof Error?err.message:'';setError(detail.includes('OR_BIBED_06')?'Google Pay rejected this merchant or payment gateway configuration (OR_BIBED_06). The Sandbox integration needs review. No payment was completed.':'Google Pay could not open a valid payment method. If the wallet says OR_BIBED_06, the provider configuration must be checked.')}})
              }})
              googleButtonRef.current.replaceChildren(button)
              setGoogleReady(true)
            }
          }catch{ /* Not eligible on this device; don't show a non-working payment button. */ }
        }
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
                  // Apple requires the session to be created directly from a user gesture.
                  const appleCtor=win.ApplePaySession!
                  const native=new appleCtor(4,{
                    countryCode:config.countryCode||'US',currencyCode:'USD',
                    merchantCapabilities:config.merchantCapabilities,supportedNetworks:config.supportedNetworks,
                    requiredBillingContactFields:['postalAddress'],requiredShippingContactFields:[],
                    total:{label:'VELQOZA AI',amount:price,type:'final'}
                  })
                  native.onvalidatemerchant=event=>{
                    void provider.validateMerchant({validationUrl:event.validationURL}).then(result=>native.completeMerchantValidation(result.merchantSession)).catch(()=>{native.abort();setError('Apple Pay merchant validation failed. The checkout domain may need PayPal registration.')})
                  }
                  native.onpaymentauthorized=event=>{
                    void (async()=>{
                      try{
                        const order=await api.startCheckout(requestId,'applepay')
                        await provider.confirmOrder({orderId:order.orderId,token:event.payment.token,billingContact:event.payment.billingContact,shippingContact:event.payment.shippingContact})
                        await api.captureCheckout(order.orderId)
                        native.completePayment({status:appleCtor.STATUS_SUCCESS})
                        successRef.current(order.orderId)
                      }catch(err){
                        native.completePayment({status:appleCtor.STATUS_FAILURE})
                        setError(err instanceof Error?err.message:'Apple Pay could not confirm the payment.')
                      }
                    })()
                  }
                  native.oncancel=()=>setError('Apple Pay was canceled.')
                  native.begin()
                }catch(err){setError(err instanceof Error?err.message:'Apple Pay is not available on this device.')}
              })
              appleButtonRef.current.replaceChildren(button)
              setAppleReady(true)
            }
          }catch{ /* Device or domain has not completed Apple Pay registration. */ }
        }
      }catch(err){
        if(active)setError(err instanceof Error?err.message:'Wallet payments unavailable.')
      }finally{if(active)setChecking(false)}
    }
    void init()
    return()=>{active=false}
  },[requestId,price])
  return <section style={{display:'grid',gap:10}}>
    <div ref={googleButtonRef} style={{display:googleReady?'block':'none',minHeight:googleReady?44:0}}/>
    <div ref={appleButtonRef} style={{display:appleReady?'block':'none'}}/>
    {checking&&<p role="status" style={{fontSize:12,color:'#aaa0c7',margin:0}}>Checking Google Pay and Apple Pay availability…</p>}
    {!checking&&!googleReady&&!appleReady&&<p style={{fontSize:12,color:'#aaa0c7',margin:0}}>Google Pay and Apple Pay are not available on this browser/device or for this Sandbox merchant.</p>}
    {error&&<p role="alert" style={{color:'#ffc4ce',fontSize:12,margin:0}}>{error}</p>}
  </section>
}
