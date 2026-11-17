export type VerifiedReceipt={
  receiptId:string;orderId:string;captureId:string;paidAt:string;currency:string;amountCents:number;
  packageName:string;email:string;credits:number;messages:number;edits:number;generations:number;paymentStatus:string
}
// Small dependency-free, printable A4 PDF; all fields come from the authenticated
// receipt API, which reads the completed server-side payment snapshot.
export function downloadReceiptPdf(receipt:VerifiedReceipt){
  const printable=(value:string)=>value.normalize('NFKD').replace(/[^\x20-\x7e]/g,'?').slice(0,160)
  const escapePdf=(value:string)=>printable(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
  const date=new Date(receipt.paidAt)
  const rows=[
    ['VELQOZA AI','',22],
    ['PAYMENT RECEIPT','',15],
    ['','',12],
    ['Payment status','PAID',12],
    ['Receipt number',receipt.receiptId,11],
    ['PayPal order',receipt.orderId,11],
    ['PayPal capture',receipt.captureId,11],
    ['Payment date',Number.isNaN(date.getTime())?receipt.paidAt:date.toISOString().replace('T',' ').slice(0,19)+' UTC',11],
    ['Account',receipt.email,11],
    ['','',12],
    ['Purchased package',receipt.packageName,12],
    ['Credits',String(receipt.credits),11],
    ['AI messages',String(receipt.messages),11],
    ['Website edits',String(receipt.edits),11],
    ['Website generations',String(receipt.generations),11],
    ['','',12],
    ['TOTAL PAID',receipt.currency+' '+(receipt.amountCents/100).toFixed(2),16],
    ['','',11],
    ['Payment processed by PayPal.','',10],
    ['Keep this receipt for your records.','',10],
    ['This receipt is proof of a recorded payment, not a tax invoice.','',9]
  ] as const
  const lines:string[]=[]
  let y=779
  for(const [label,value,size] of rows){
    const left=escapePdf(label),right=escapePdf(value)
    if(left)lines.push('BT /F1 '+size+' Tf 55 '+y+' Td ('+left+') Tj ET')
    if(right)lines.push('BT /F1 '+size+' Tf 300 '+y+' Td ('+right+') Tj ET')
    y-=label==='VELQOZA AI'?45:label==='TOTAL PAID'?34:25
  }
  const stream=lines.join('\n')+'\n'
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length '+new TextEncoder().encode(stream).length+' >>\nstream\n'+stream+'endstream'
  ]
  let pdf='%PDF-1.4\n'
  const offsets=[0]
  for(let i=0;i<objects.length;i++){
    offsets.push(new TextEncoder().encode(pdf).length)
    pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'
  }
  const xref=new TextEncoder().encode(pdf).length
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
  for(const offset of offsets.slice(1))pdf+=String(offset).padStart(10,'0')+' 00000 n \n'
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'
  const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}))
  const a=document.createElement('a')
  a.href=url;a.download='VELQOZA-AI-Receipt-'+printable(receipt.orderId)+'.pdf'
  document.body.append(a);a.click();a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1500)
}
