import {useEffect,useRef,useState} from 'react'
import {api} from './api'
type CardSession={
  createCardFieldsComponent:(options:{type:'number'|'expiry'|'cvv';placeholder:string})=>HTMLElement
  submit:(orderId:string,options?:Record<string,unknown>)=>Promise<{state:'succeeded'|'canceled'|'failed'|string;data?:{orderId?:string;message?:string;liabilityShift?:string}}>
}
type SdkInstance={
  findEligibleMethods:()=>Promise<{isEligible:(name:string)=>boolean}>
  createCardFieldsOneTimePaymentSession:()=>CardSession
}
type PayPalWindow=Window & {paypal?:{createInstance:(options:{clientToken:string;components:string[];pageType?:string})=>Promise<SdkInstance>}}
let paypalSdkLoader:Promise<void>|null=null
function loadSandboxSdk(src:string){
  if(src!=='https://www.sandbox.paypal.com/web-sdk/v6/core')throw new Error('Unexpected PayPal SDK source.')
  if((window as PayPalWindow).paypal?.createInstance)return Promise.resolve()
  if(!paypalSdkLoader){
    paypalSdkLoader=new Promise<void>((resolve,reject)=>{
      const script=document.createElement('script')
      script.src=src
      script.async=true
      script.onload=()=>((window as PayPalWindow).paypal?.createInstance?resolve():reject(new Error('PayPal Card Fields failed to initialize.')))
      script.onerror=()=>reject(new Error('Could not load PayPal card components.'))
      document.head.appendChild(script)
    }).catch(error=>{paypalSdkLoader=null;throw error})
  }
  return paypalSdkLoader
}
export function CardPaymentFields({requestId,amountCents,onSuccess}:{requestId:string;amountCents:number;onSuccess:(orderId:string)=>void}){
  const numberRef=useRef<HTMLDivElement>(null),expiryRef=useRef<HTMLDivElement>(null),cvvRef=useRef<HTMLDivElement>(null)
  const sessionRef=useRef<CardSession|null>(null)
  const [state,setState]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{
    let alive=true
    const init=async()=>{
      try{
        const config=await api.cardFieldsToken()
        await loadSandboxSdk(config.sdkUrl)
        if(!alive)return
        const sdk=await (window as PayPalWindow).paypal!.createInstance({
          clientToken:config.clientToken,components:['card-fields'],pageType:'checkout'
        })
        const methods=await sdk.findEligibleMethods()
        if(!methods.isEligible('advanced_cards'))throw new Error('This PayPal Sandbox merchant is not eligible for Advanced Credit / Debit Card payments. Enable Advanced Card Payments in PayPal Developer, or use PayPal.')
        const session=sdk.createCardFieldsOneTimePaymentSession()
        if(!alive)return
        for(const [ref,type,placeholder] of [[numberRef,'number','Card number'],[expiryRef,'expiry','MM/YY'],[cvvRef,'cvv','CVV']] as const){
          if(!ref.current)throw new Error('Card field could not be mounted.')
          ref.current.replaceChildren(session.createCardFieldsComponent({type,placeholder}))
        }
        sessionRef.current=session
        setState('ready')
      }catch(err){
        if(alive){setState('unavailable');setError(err instanceof Error?err.message:'Card fields are unavailable.')}
      }
    }
    void init()
    return ()=>{alive=false;sessionRef.current=null}
  },[requestId])
  const submit=async()=>{
    if(busy||!sessionRef.current)return
    setBusy(true);setError('')
    try{
      const order=await api.startCheckout(requestId,'card')
      const result=await sessionRef.current.submit(order.orderId)
      if(result.state==='canceled'){setError('Card authentication was canceled. No Credits were granted.');return}
      if(result.state!=='succeeded'||result.data?.orderId!==order.orderId){
        setError(result.data?.message||'Card validation failed. Check your details and try again.')
        return
      }
      // PayPal's card SDK processed the card/3DS; only our server can capture
      // and verify the exact immutable amount and grant Credits.
      await api.captureCheckout(order.orderId)
      onSuccess(order.orderId)
    }catch(err){setError(err instanceof Error?err.message:'Could not complete card checkout. Check payment status before retrying.')}
    finally{setBusy(false)}
  }
  return <section style={{marginTop:14,padding:'18px',border:'1px solid #5e4b7d',background:'#161027',borderRadius:13}}>
    <strong style={{fontSize:16}}>Credit / Debit Card</strong>
    <p style={{fontSize:12,color:'#b7a9d1',lineHeight:1.5}}>Secure card fields are hosted by PayPal. VELQOZA cannot read or store your card number or CVV.</p>
    <div style={{display:'grid',gap:12,marginTop:16}}>
      {[['Card number',numberRef],['Expiration date',expiryRef],['Security code (CVV)',cvvRef]].map(([label,ref])=><label key={label as string} style={{display:'grid',gap:6,fontSize:13,fontWeight:600}}>
        {label as string}
        <div ref={ref as React.RefObject<HTMLDivElement>} style={{height:52,background:'#faf8ff',border:'1px solid #80748f',borderRadius:9,overflow:'hidden',padding:'4px'}}/>
      </label>)}
    </div>
    {state==='loading'&&<p role="status" style={{color:'#cbb7f3'}}>Checking whether card payments are available…</p>}
    {error&&<p role="alert" style={{color:'#ffd0d0',fontSize:13,lineHeight:1.5}}>{error}</p>}
    <button type="button" disabled={state!=='ready'||busy} onClick={()=>void submit()} style={{marginTop:17,width:'100%',padding:'15px 18px',background:state==='ready'?'#c9a9ff':'#4b4260',color:'#180f28',borderRadius:10,border:0,fontWeight:800,cursor:state==='ready'?'pointer':'not-allowed'}}>
      {busy?'Confirming secure payment…':`Pay USD ${(amountCents/100).toFixed(2)}`}
    </button>
    <p style={{fontSize:11,color:'#b29fc9'}}>Sandbox test only — no real money is charged. Do not enter real card details.</p>
  </section>
}
