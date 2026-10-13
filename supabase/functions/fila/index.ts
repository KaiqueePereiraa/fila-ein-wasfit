// Edge function da fila do stand WasFit (EIN 2026).
// Ações públicas: entrar, status. Ações do painel (exigem PIN): lista, chamar,
// chegou, finalizar, pular, rechamar, remover, voltar, exportar.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Projetos novos expõem as chaves secretas em SUPABASE_SECRET_KEYS; os antigos, em SUPABASE_SERVICE_ROLE_KEY.
function chaveServico(): string {
  const legado = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legado) return legado;
  try {
    const chaves = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return chaves.default ?? Object.values(chaves)[0] ?? "";
  } catch {
    return "";
  }
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, chaveServico());
const WEBHOOK = Deno.env.get("WASFIT_WEBHOOK_URL") ?? "";
const PIN = Deno.env.get("PAINEL_PIN") ?? "";
const SITE = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");

const ATENDENTES = 2;
const TOLERANCIA_MIN = 5; // tempo para a pessoa aparecer depois de chamada
const DURACAO_PADRAO_MIN = 10; // usado até termos atendimentos finalizados
const AVISAR_ATE_POSICAO = 2; // "prepare-se" quando restar 1 pessoa na frente
const ATIVOS = ["aguardando", "chamado", "atendendo"];

// Limites contra abuso (cadastros em massa disparariam WhatsApp e arriscam o número na Meta)
const LIMITE_CADASTROS_IP = 15; // por IP a cada 10 min (Wi-Fi da feira é compartilhado)
const LIMITE_CADASTROS_TOTAL = 150; // no sistema todo a cada 10 min
const LIMITE_PIN_ERRADO_IP = 8; // tentativas erradas por IP a cada 15 min
const LIMITE_PIN_ERRADO_TOTAL = 40; // tentativas erradas no total a cada 15 min

const cors = {
  "Access-Control-Allow-Origin": SITE ? new URL(SITE).origin : "*",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "content-type, x-painel-pin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type Pessoa = {
  id: string;
  nome: string;
  telefone: string;
  cargo: string | null;
  email: string | null;
  escola: string | null;
  instagram: string | null;
  status: string;
  pulos: number;
  avisado_proximo: boolean;
  entrou_em: string;
  fila_desde: string;
  chamado_em: string | null;
  chegou_em: string | null;
  finalizado_em: string | null;
  atendente: string | null;
  dia: string;
};

const primeiroNome = (n: string) => n.trim().split(/\s+/)[0];

function normalizarTelefone(bruto: string): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

const limpar = (v: unknown, max = 120) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

function normalizarInstagram(v: unknown): string | null {
  const s = limpar(v, 200);
  if (!s) return null;
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const user = (m ? m[1] : s).replace(/^@+/, "").replace(/\/.*$/, "");
  return user ? "@" + user : null;
}

async function enviarWhatsApp(p: Pessoa, mensagem: string) {
  if (!WEBHOOK) {
    console.warn("WASFIT_WEBHOOK_URL não configurado; mensagem não enviada");
    return false;
  }
  try {
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: p.nome,
        telefone: p.telefone,
        mensagem,
        cargo: p.cargo ?? "",
        email: p.email ?? "",
        escola: p.escola ?? "",
        instagram: p.instagram ?? "",
        evento: "EIN 2026",
      }),
    });
    if (!r.ok) console.error("webhook WasFit", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("webhook WasFit falhou", e);
    return false;
  }
}

async function duracaoMediaMin(): Promise<number> {
  const { data } = await sb
    .from("fila")
    .select("chegou_em, finalizado_em")
    .eq("status", "atendido")
    .not("chegou_em", "is", null)
    .order("finalizado_em", { ascending: false })
    .limit(10);
  const dur = (data ?? [])
    .map((r) => (Date.parse(r.finalizado_em) - Date.parse(r.chegou_em)) / 60000)
    .filter((m) => m > 0.5 && m < 90);
  if (!dur.length) return DURACAO_PADRAO_MIN;
  return dur.reduce((a, b) => a + b, 0) / dur.length;
}

async function aguardando(): Promise<Pessoa[]> {
  const { data, error } = await sb
    .from("fila")
    .select("*")
    .eq("status", "aguardando")
    .order("fila_desde", { ascending: true });
  if (error) throw error;
  return data as Pessoa[];
}

async function posicaoDe(id: string) {
  const fila = await aguardando();
  const idx = fila.findIndex((p) => p.id === id);
  const media = await duracaoMediaMin();
  const posicao = idx === -1 ? null : idx + 1;
  const espera = posicao === null
    ? null
    : Math.max(2, Math.round(Math.ceil(posicao / ATENDENTES) * media));
  return { posicao, na_frente: posicao === null ? null : posicao - 1, espera_min: espera, na_fila: fila.length };
}

async function buscar(id: string): Promise<Pessoa | null> {
  const { data } = await sb.from("fila").select("*").eq("id", id).maybeSingle();
  return data as Pessoa | null;
}

async function atualizar(id: string, campos: Partial<Pessoa>, deStatus?: string[]) {
  let q = sb.from("fila").update(campos).eq("id", id);
  if (deStatus) q = q.in("status", deStatus);
  const { data, error } = await q.select("*").maybeSingle();
  if (error) throw error;
  return data as Pessoa | null;
}

const linkAcompanhar = (id: string) => (SITE ? `\n\nAcompanhe sua posição: ${SITE}/?t=${id}` : "");

const naFrente = (n: number) =>
  n === 0 ? "você é o(a) *próximo(a)*" : n === 1 ? "*1 pessoa* na sua frente" : `*${n} pessoas* na sua frente`;

const msg = {
  entrou: (p: Pessoa, pos: number, min: number) =>
    `Oi, ${primeiroNome(p.nome)}! 👋 Você entrou na fila do stand da *WasFit* na EIN 2026.\n\n` +
    `Agora: ${naFrente(pos - 1)} · espera estimada: *~${min} min*.\n\n` +
    `Pode circular pela feira tranquilo(a), a gente te chama aqui quando chegar a sua vez.` +
    linkAcompanhar(p.id),
  preparar: (p: Pessoa, pos: number) =>
    `${primeiroNome(p.nome)}, falta pouco! ⏱️ Agora ${naFrente(pos - 1)}.\n\n` +
    `Já pode ir se aproximando do stand da *WasFit*, vamos te chamar em instantes.`,
  chamado: (p: Pessoa) =>
    `${primeiroNome(p.nome)}, chegou a sua vez! 🏊\n\n` +
    `Venha agora para o stand da *WasFit*. Vamos te esperar por *${TOLERANCIA_MIN} minutos*.`,
  rechamar: (p: Pessoa) =>
    `${primeiroNome(p.nome)}, ainda estamos te esperando no stand da *WasFit*! ⏳ Venha assim que puder.`,
  pulado: (p: Pessoa, pos: number) =>
    `${primeiroNome(p.nome)}, chamamos você mas não te encontramos no stand 😕\n\n` +
    `Sem problema: você voltou para a fila, com ${naFrente(pos - 1)}. Te avisamos de novo por aqui.`,
  desistiu: (p: Pessoa) =>
    `${primeiroNome(p.nome)}, como não conseguimos te encontrar, liberamos a sua vez na fila.\n\n` +
    `Se ainda quiser conhecer a WasFit, é só passar no stand ou responder esta mensagem 💚`,
};

// Manda o "prepare-se" para quem chegou perto do início da fila e ainda não recebeu.
async function avisarProximos() {
  const fila = (await aguardando()).slice(0, AVISAR_ATE_POSICAO);
  for (const [i, cand] of fila.entries()) {
    if (cand.avisado_proximo) continue;
    const p = await atualizar(cand.id, { avisado_proximo: true }, ["aguardando"]);
    if (p) await enviarWhatsApp(p, msg.preparar(p, i + 1));
  }
}

// ---------- limites de uso ----------

async function contar(chave: string, janelaMin: number): Promise<number> {
  const desde = new Date(Date.now() - janelaMin * 60000).toISOString();
  const { count, error } = await sb
    .from("tentativas")
    .select("*", { count: "exact", head: true })
    .eq("chave", chave)
    .gte("criado_em", desde);
  if (error) throw error;
  return count ?? 0;
}

async function registrar(...chaves: string[]) {
  await sb.from("tentativas").insert(chaves.map((chave) => ({ chave })));
  // limpeza ocasional do que tem mais de 1 dia
  if (Math.random() < 0.05) {
    await sb.from("tentativas").delete().lt("criado_em", new Date(Date.now() - 86400000).toISOString());
  }
}

const muitas = () => json({ erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." }, 429);

// ---------- ações públicas ----------

async function entrar(b: Record<string, unknown>, ip: string) {
  if (
    (await contar(`cad:${ip}`, 10)) >= LIMITE_CADASTROS_IP ||
    (await contar("cad:total", 10)) >= LIMITE_CADASTROS_TOTAL
  ) return muitas();

  const nome = limpar(b.nome, 80);
  const telefone = normalizarTelefone(String(b.telefone ?? ""));
  if (!nome) return json({ erro: "Informe seu nome." }, 400);
  if (!telefone) return json({ erro: "WhatsApp inválido. Use DDD + número." }, 400);

  // Mesmo telefone já ativo na fila? Devolve o cadastro existente.
  const { data: existente } = await sb
    .from("fila")
    .select("*")
    .eq("telefone", telefone)
    .in("status", ATIVOS)
    .maybeSingle();
  if (existente) return json({ id: existente.id, ja_estava: true });

  const { data, error } = await sb
    .from("fila")
    .insert({
      nome,
      telefone,
      cargo: limpar(b.cargo, 60),
      email: limpar(b.email, 120)?.toLowerCase() ?? null,
      escola: limpar(b.escola, 120),
      instagram: normalizarInstagram(b.instagram),
    })
    .select("*")
    .single();
  if (error) throw error;

  const p = data as Pessoa;
  await registrar(`cad:${ip}`, "cad:total");
  const { posicao, espera_min } = await posicaoDe(p.id);
  if (posicao !== null && posicao <= AVISAR_ATE_POSICAO) {
    await atualizar(p.id, { avisado_proximo: true });
  }
  await enviarWhatsApp(p, msg.entrou(p, posicao ?? 1, espera_min ?? DURACAO_PADRAO_MIN));
  return json({ id: p.id });
}

async function status(b: Record<string, unknown>) {
  const p = await buscar(String(b.id ?? ""));
  if (!p) return json({ erro: "Cadastro não encontrado." }, 404);
  const pos = p.status === "aguardando" ? await posicaoDe(p.id) : null;
  return json({
    nome: primeiroNome(p.nome),
    status: p.status,
    posicao: pos?.posicao ?? null,
    na_frente: pos?.na_frente ?? null,
    espera_min: pos?.espera_min ?? null,
    chamado_em: p.chamado_em,
    tolerancia_min: TOLERANCIA_MIN,
  });
}

// ---------- ações do painel ----------

async function lista() {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { data: ativos } = await sb
    .from("fila")
    .select("*")
    .in("status", ATIVOS)
    .order("fila_desde", { ascending: true });
  const { data: encerrados } = await sb
    .from("fila")
    .select("*")
    .in("status", ["atendido", "desistiu"])
    .eq("dia", hoje)
    .order("finalizado_em", { ascending: false });

  const fin = (encerrados ?? []) as Pessoa[];
  const atendidos = fin.filter((p) => p.status === "atendido");
  const esperas = [...(ativos ?? []), ...fin]
    .filter((p: Pessoa) => p.chamado_em && p.dia === hoje)
    .map((p: Pessoa) => (Date.parse(p.chamado_em!) - Date.parse(p.entrou_em)) / 60000);
  const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  return json({
    agora: new Date().toISOString(),
    tolerancia_min: TOLERANCIA_MIN,
    ativos: ativos ?? [],
    encerrados: fin,
    stats: {
      aguardando: (ativos ?? []).filter((p: Pessoa) => p.status === "aguardando").length,
      atendidos_hoje: atendidos.length,
      desistencias_hoje: fin.length - atendidos.length,
      espera_media_min: media(esperas),
      duracao_media_min: Math.round(await duracaoMediaMin()),
    },
  });
}

async function chamar(b: Record<string, unknown>) {
  const atendente = limpar(b.atendente, 40);
  const campos = { status: "chamado", chamado_em: new Date().toISOString(), atendente };
  let p: Pessoa | null = null;
  if (b.id) {
    p = await atualizar(String(b.id), campos, ["aguardando"]);
  } else {
    // Próximo da fila. Se outro atendente pegar a mesma pessoa no mesmo instante, tenta o seguinte.
    for (const cand of (await aguardando()).slice(0, 5)) {
      p = await atualizar(cand.id, campos, ["aguardando"]);
      if (p) break;
    }
  }
  if (!p) return json({ erro: "Ninguém aguardando na fila." }, 409);
  const enviado = await enviarWhatsApp(p, msg.chamado(p));
  await avisarProximos();
  return json({ ok: true, pessoa: p, enviado });
}

async function rechamar(b: Record<string, unknown>) {
  const p = await buscar(String(b.id));
  if (!p || p.status !== "chamado") return json({ erro: "Pessoa não está chamada." }, 409);
  const enviado = await enviarWhatsApp(p, msg.rechamar(p));
  return json({ ok: true, enviado });
}

async function chegou(b: Record<string, unknown>) {
  const p = await atualizar(
    String(b.id),
    { status: "atendendo", chegou_em: new Date().toISOString(), atendente: limpar(b.atendente, 40) },
    ["chamado", "aguardando"],
  );
  if (!p) return json({ erro: "Não foi possível marcar a chegada." }, 409);
  return json({ ok: true });
}

async function finalizar(b: Record<string, unknown>) {
  const p = await atualizar(
    String(b.id),
    { status: "atendido", finalizado_em: new Date().toISOString() },
    ["atendendo", "chamado"],
  );
  if (!p) return json({ erro: "Não foi possível finalizar." }, 409);
  return json({ ok: true });
}

async function pular(b: Record<string, unknown>) {
  const atual = await buscar(String(b.id));
  if (!atual || atual.status !== "chamado") return json({ erro: "Só dá para pular quem foi chamado." }, 409);

  if (atual.pulos >= 1) {
    const p = await atualizar(atual.id, { status: "desistiu", finalizado_em: new Date().toISOString() }, ["chamado"]);
    if (p) await enviarWhatsApp(p, msg.desistiu(p));
    return json({ ok: true, resultado: "desistiu" });
  }
  const p = await atualizar(
    atual.id,
    { status: "aguardando", pulos: atual.pulos + 1, fila_desde: new Date().toISOString(), chamado_em: null, avisado_proximo: false },
    ["chamado"],
  );
  if (!p) return json({ erro: "Não foi possível pular." }, 409);
  const { posicao } = await posicaoDe(p.id);
  if (posicao !== null && posicao <= AVISAR_ATE_POSICAO) await atualizar(p.id, { avisado_proximo: true });
  await enviarWhatsApp(p, msg.pulado(p, posicao ?? 1));
  return json({ ok: true, resultado: "voltou_para_fila", posicao });
}

async function remover(b: Record<string, unknown>) {
  const p = await atualizar(String(b.id), { status: "desistiu", finalizado_em: new Date().toISOString() }, ATIVOS);
  if (!p) return json({ erro: "Não foi possível remover." }, 409);
  await avisarProximos();
  return json({ ok: true });
}

async function voltar(b: Record<string, unknown>) {
  // Desfaz um "desistiu"/"pular" errado: volta pro fim da fila, sem mensagem.
  const p = await atualizar(
    String(b.id),
    { status: "aguardando", fila_desde: new Date().toISOString(), chamado_em: null, finalizado_em: null, avisado_proximo: false },
    ["desistiu", "chamado"],
  );
  if (!p) return json({ erro: "Não foi possível voltar para a fila." }, 409);
  return json({ ok: true });
}

async function exportar() {
  const { data, error } = await sb.from("fila").select("*").order("entrou_em", { ascending: true });
  if (error) throw error;
  return json({ linhas: data });
}

const publicas: Record<string, (b: Record<string, unknown>, ip: string) => Promise<Response>> = { entrar, status };
const painel: Record<string, (b: Record<string, unknown>) => Promise<Response>> = {
  lista, chamar, rechamar, chegou, finalizar, pular, remover, voltar, exportar,
  login: async () => json({ ok: true }),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const acao = String(b.acao ?? "");
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sem-ip";
    if (publicas[acao]) return await publicas[acao](b, ip);
    if (painel[acao]) {
      if (
        (await contar(`pin:${ip}`, 15)) >= LIMITE_PIN_ERRADO_IP ||
        (await contar("pin:total", 15)) >= LIMITE_PIN_ERRADO_TOTAL
      ) return muitas();
      if (!PIN || req.headers.get("x-painel-pin") !== PIN) {
        await registrar(`pin:${ip}`, "pin:total");
        return json({ erro: "PIN inválido." }, 401);
      }
      return await painel[acao](b);
    }
    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: "Erro interno. Tente de novo." }, 500);
  }
});
