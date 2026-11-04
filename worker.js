// Servidor gratuito (Cloudflare Workers) que conversa com o Claude para o app.
// Faz duas coisas: ler a foto da receita e responder o assistente de dúvidas.
// A chave fica guardada como segredo ANTHROPIC_API_KEY, nunca dentro do app.
// Idealizado por Farmacêutica Dra. Ana Paula de Andrade Barbosa.
const RX_PROMPT="Leia esta receita médica e extraia os medicamentos. Responda SOMENTE JSON no formato {\"meds\":[{\"name\":\"nome do medicamento\",\"doseText\":\"concentração e posologia como está escrito, ex.: 50 mg, 1 comprimido de 8 em 8 horas\",\"qty\":1,\"unit\":\"comprimido(s)\",\"times_per_day\":1,\"days_of_week\":[],\"duration_days\":0}]}. unit deve ser um destes: comprimido(s), cápsula(s), gota(s), mL, aplicação(ões), sachê(s), dose(s), unidade(s). days_of_week usa 0=domingo a 6=sábado e [] significa todos os dias. duration_days é 0 se o uso for contínuo ou não informado. Não invente nada que não esteja legível na receita.";
const CHAT_INSTR="Você é um assistente de informação sobre medicamentos dentro de um aplicativo de lembretes. Responda em português do Brasil, em linguagem simples, com no máximo 6 frases. Dê informação geral e educativa. Não faça diagnóstico, não prescreva e não mande mudar, parar ou dobrar doses: nesses casos diga para falar com o médico ou farmacêutico. Para dose esquecida, explique que depende do medicamento e oriente consultar a bula ou o farmacêutico. Se houver sinais de emergência (falta de ar, inchaço no rosto, desmaio, dor forte no peito, convulsão, suspeita de intoxicação), oriente ligar 192 (SAMU) ou procurar um pronto atendimento. Se não tiver certeza, diga que não sabe. Você é uma IA: lembre isso quando falar de segurança.";
const EXAM_PROMPT="Leia este resultado de exame (laboratório ou imagem) e extraia os dados. Responda SOMENTE JSON no formato {\"date\":\"AAAA-MM-DD ou vazio\",\"lab\":\"nome do laboratório ou vazio\",\"items\":[{\"name\":\"nome do exame\",\"value\":\"valor como está escrito\",\"unit\":\"unidade\",\"ref\":\"valor de referência como está escrito\",\"flag\":\"alto ou baixo ou normal ou vazio\"}],\"summary\":\"explicação simples, em até 4 frases, do que o documento mostra, sem diagnóstico e sem sugerir tratamento ou mudança de remédio; termine dizendo para conversar com o médico\"}. Use flag alto ou baixo somente se o próprio documento indicar ou se o valor estiver claramente fora da referência impressa; caso contrário deixe vazio. No máximo 40 itens. Não invente nada que não esteja legível.";
const MODEL="claude-sonnet-5-5";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const ALLOWED=["https://draanapaulabarbosa.github.io","https://localhost","capacitor://localhost"];
const j=(o,s)=>new Response(JSON.stringify(o),{status:s||200,headers:{...cors,"Content-Type":"application/json"}});
async function ask(env,body){
  const key=String(env.ANTHROPIC_API_KEY||"").replace(/[^\x21-\x7E]/g,"");
  if(key.indexOf("sk-ant")!==0)throw new Error("chave invalida: comeca com \""+key.slice(0,6)+"\" e tem "+key.length+" caracteres");
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:MODEL,...body})});
  const d=await r.json();
  if(d.error)throw new Error(String(d.error.type||"erro")+": "+String(d.error.message||"").slice(0,160));
  const tx=(d.content||[]).map(c=>c.text||"").join("");
  if(!tx)throw new Error("vazio: "+JSON.stringify(d).slice(0,200));
  return tx;
}
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return j({ ok: true });
    if (ALLOWED.indexOf(req.headers.get("Origin")||"") < 0) return j({ error: "acesso negado" }, 403);
    try {
      const b = await req.json();
      if (b.image) {
        if (b.image.length > 7000000) return j({ error: "imagem grande demais" }, 400);
        const exam = b.mode === "exam", mt = b.media_type || "image/jpeg";
        const blk = mt === "application/pdf" ? {type:"document",source:{type:"base64",media_type:"application/pdf",data:b.image}} : {type:"image",source:{type:"base64",media_type:mt,data:b.image}};
        const t = await ask(env,{max_tokens:exam?3500:1500,messages:[{role:"user",content:[blk,{type:"text",text:exam?EXAM_PROMPT:RX_PROMPT}]}]});
        return j(JSON.parse(t.replace(/```json|```/g,"").trim()));
      }
      if (Array.isArray(b.messages) && b.messages.length) {
        const msgs=b.messages.slice(-12).map(m=>({role:m.role==="assistant"?"assistant":"user",content:String(m.content||"").slice(0,2000)}));
        const sys=CHAT_INSTR+(b.context?"\n\n"+String(b.context).slice(0,3000):"");
        const t = await ask(env,{max_tokens:700,system:sys,messages:msgs});
        return j({ text: t });
      }
      return j({ error: "pedido inválido" }, 400);
    } catch (e) { return j({ error: "falha", detail: String(e.message||"").slice(0,200) }, 500); }
  }
};
