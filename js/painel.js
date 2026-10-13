const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let PIN = store.get("fila-pin");
let ATENDENTE = store.get("fila-atendente") || "";
let dados = null, offset = 0, timer;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const agora = () => Date.now() + offset;
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const min = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60000) + " min" : "–");
const telFmt = (t) => {
  const d = t.replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return t;
};

function aviso(txt) {
  $("aviso").textContent = txt; $("aviso").classList.remove("oculto");
  clearTimeout(aviso.t); aviso.t = setTimeout(() => $("aviso").classList.add("oculto"), 3500);
}

function detalhes(p) {
  const partes = [p.cargo, p.escola].filter(Boolean).map(esc);
  if (p.instagram) partes.push(`<a href="https://instagram.com/${esc(p.instagram.slice(1))}" target="_blank" rel="noopener">${esc(p.instagram)}</a>`);
  partes.push(`<a href="https://wa.me/${esc(p.telefone)}" target="_blank" rel="noopener">${telFmt(p.telefone)}</a>`);
  return partes.join(" · ");
}

function render() {
  if (!dados) return;
  const tol = dados.tolerancia_min * 60000;
  const ativos = dados.ativos;
  const chamados = ativos.filter((p) => p.status === "chamado").sort((a, b) => Date.parse(a.chamado_em) - Date.parse(b.chamado_em));
  const atendendo = ativos.filter((p) => p.status === "atendendo");
  const fila = ativos.filter((p) => p.status === "aguardando");

  $("n-chamados").textContent = chamados.length;
  $("n-atendendo").textContent = atendendo.length;
  $("n-fila").textContent = fila.length;

  $("chamados").innerHTML = chamados.length ? chamados.map((p) => {
    const passou = agora() - Date.parse(p.chamado_em);
    const atrasado = passou > tol;
    return `<div class="pessoa chamado ${atrasado ? "atrasado" : ""}">
      <div class="linha1"><div class="nome">${esc(p.nome)}${p.pulos ? '<span class="tag">2ª chamada</span>' : ""}</div>
        <div class="tempo" data-desde="${p.chamado_em}" data-limite="${tol}">${atrasado ? "+" + mmss(passou - tol) : mmss(tol - passou)}</div></div>
      <div class="det">${detalhes(p)}${p.atendente ? " · chamado por " + esc(p.atendente) : ""}</div>
      <div class="botoes">
        <button data-acao="chegou" data-id="${p.id}">✓ Chegou</button>
        <button class="secundario" data-acao="rechamar" data-id="${p.id}">Rechamar</button>
        <button class="perigo" data-acao="pular" data-id="${p.id}" data-pulos="${p.pulos}">${p.pulos ? "Não veio · encerrar" : "Não veio · pular"}</button>
      </div></div>`;
  }).join("") : '<div class="vazio">Ninguém chamado agora</div>';

  $("atendendo").innerHTML = atendendo.length ? atendendo.map((p) => `
    <div class="pessoa atendendo">
      <div class="linha1"><div class="nome">${esc(p.nome)}</div><div class="tempo" data-desde="${p.chegou_em}">${mmss(agora() - Date.parse(p.chegou_em))}</div></div>
      <div class="det">${detalhes(p)}${p.atendente ? " · com " + esc(p.atendente) : ""}</div>
      <div class="botoes"><button class="azul" data-acao="finalizar" data-id="${p.id}">Finalizar atendimento</button></div>
    </div>`).join("") : '<div class="vazio">Nenhum atendimento em andamento</div>';

  $("fila").innerHTML = fila.length ? fila.map((p, i) => `
    <div class="fila-item">
      <div class="pos">${i + 1}</div>
      <div><div class="nome">${esc(p.nome)}${p.pulos ? '<span class="tag">pulado</span>' : ""}</div>
        <div class="det">${[p.cargo, p.escola].filter(Boolean).map(esc).join(" · ")}${p.cargo || p.escola ? " · " : ""}há <span data-desde="${p.entrou_em}" data-fmt="min">${Math.floor((agora() - Date.parse(p.entrou_em)) / 60000)} min</span></div></div>
      <div class="mini">
        <button class="secundario" data-acao="chamar" data-id="${p.id}" title="Chamar esta pessoa agora">Chamar</button>
        <button class="perigo" data-acao="remover" data-id="${p.id}" title="Tirar da fila">✕</button>
      </div>
    </div>`).join("") : '<div class="vazio">Fila vazia 🎉</div>';

  $("chamar-proximo").disabled = !fila.length;
  $("chamar-proximo").textContent = fila.length ? `Chamar próximo · ${fila[0].nome.split(" ")[0]}` : "Fila vazia";

  const s = dados.stats;
  $("s-aguardando").textContent = s.aguardando;
  $("s-espera").textContent = s.espera_media_min != null ? s.espera_media_min + " min" : "–";
  $("s-atendidos").textContent = s.atendidos_hoje;
  $("s-duracao").textContent = s.duracao_media_min + " min";
  $("s-desist").textContent = s.desistencias_hoje;

  $("n-fim").textContent = dados.encerrados.length;
  $("encerrados").innerHTML = dados.encerrados.map((p) => `<tr>
    <td>${esc(p.nome)}</td><td>${esc(p.escola)}</td>
    <td>${p.status === "atendido" ? "Atendido" : "Desistiu"}</td>
    <td>${min(p.entrou_em, p.chamado_em)}</td><td>${min(p.chegou_em, p.finalizado_em)}</td><td>${esc(p.atendente)}</td>
    <td>${p.status === "desistiu" ? `<button class="secundario" style="padding:6px 10px;font-size:12px" data-acao="voltar" data-id="${p.id}">Voltar p/ fila</button>` : ""}</td>
  </tr>`).join("");
}

// Atualiza só os cronômetros a cada segundo, sem redesenhar a lista
setInterval(() => {
  document.querySelectorAll("[data-desde]").forEach((el) => {
    const passou = agora() - Date.parse(el.dataset.desde);
    if (el.dataset.fmt === "min") return (el.textContent = Math.floor(passou / 60000) + " min");
    if (el.dataset.limite) {
      const lim = +el.dataset.limite;
      el.textContent = passou > lim ? "+" + mmss(passou - lim) : mmss(lim - passou);
      el.closest(".pessoa").classList.toggle("atrasado", passou > lim);
    } else el.textContent = mmss(passou);
  });
}, 1000);

async function carregar() {
  clearTimeout(timer);
  try {
    const r = await api("lista", {}, PIN);
    offset = Date.parse(r.agora) - Date.now();
    dados = r; render();
    $("conexao").textContent = "● ao vivo"; $("conexao").classList.remove("ruim");
  } catch (e) {
    if (e.status === 401) return sair();
    $("conexao").textContent = "● sem conexão"; $("conexao").classList.add("ruim");
  }
  timer = setTimeout(carregar, 4000);
}

const textos = {
  chamar: "Chamado! WhatsApp enviado.",
  rechamar: "Mensagem reenviada.",
  chegou: "Atendimento iniciado.",
  finalizar: "Atendimento finalizado.",
  remover: "Removido da fila.",
  voltar: "Voltou para o fim da fila.",
};

async function executar(acao, id, botao) {
  if (acao === "pular") {
    const encerra = botao.dataset.pulos !== "0";
    if (!confirm(encerra ? "Segunda vez que não aparece: encerrar e liberar a vez?" : "Não apareceu? Ela volta para o fim da fila e recebe aviso no WhatsApp.")) return;
  }
  if (acao === "remover" && !confirm("Tirar esta pessoa da fila? (não envia mensagem)")) return;
  if (botao) botao.disabled = true;
  try {
    const r = await api(acao, { id, atendente: ATENDENTE }, PIN);
    if (acao === "pular") aviso(r.resultado === "desistiu" ? "Encerrado. Aviso enviado." : `Voltou para a fila (${r.posicao}º). Aviso enviado.`);
    else if (acao === "chamar") aviso(r.enviado === false ? `⚠️ ${r.pessoa.nome} chamado, mas o WhatsApp falhou. Use Rechamar.` : `${r.pessoa.nome} chamado! WhatsApp enviado.`);
    else if (acao === "rechamar" && r.enviado === false) aviso("⚠️ Falha ao reenviar o WhatsApp.");
    else aviso(textos[acao] || "Feito.");
  } catch (e) {
    aviso(e.message);
  }
  await carregar();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-acao]");
  if (b) executar(b.dataset.acao, b.dataset.id, b);
});
$("chamar-proximo").addEventListener("click", (e) => executar("chamar", undefined, e.currentTarget));

$("exportar").addEventListener("click", async () => {
  try {
    const { linhas } = await api("exportar", {}, PIN);
    const cols = ["dia", "nome", "telefone", "cargo", "email", "escola", "instagram", "status", "pulos", "entrou_em", "chamado_em", "chegou_em", "finalizado_em", "atendente"];
    // Prefixa ' em valores que o Excel interpretaria como fórmula
    const cel = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const dt = (v) => (v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
    const csv = [cols.join(";"), ...linhas.map((l) => cols.map((c) => cel(c.endsWith("_em") ? dt(l[c]) : l[c])).join(";"))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `leads-ein-2026-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  } catch (e) { aviso(e.message); }
});

function sair() {
  clearTimeout(timer); PIN = null; store.set("fila-pin", null);
  $("app").classList.add("oculto"); $("login").classList.remove("oculto");
}
$("sair").addEventListener("click", sair);

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("erro-login").textContent = "";
  try {
    await api("login", {}, $("pin").value);
    PIN = $("pin").value; store.set("fila-pin", PIN);
    ATENDENTE = $("atendente-login").value.trim(); store.set("fila-atendente", ATENDENTE);
    iniciar();
  } catch (err) { $("erro-login").textContent = err.status === 401 ? "PIN incorreto." : err.message; }
});

// Mantém a tela do celular acesa enquanto o painel está aberto
let travaTela = null;
async function manterTelaAcesa() {
  try { if ("wakeLock" in navigator && !document.hidden) travaTela = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && PIN) { manterTelaAcesa(); carregar(); }
});

function iniciar() {
  manterTelaAcesa();
  $("login").classList.add("oculto"); $("app").classList.remove("oculto");
  $("eu").textContent = ATENDENTE ? "· " + ATENDENTE : "";
  carregar();
}

$("atendente-login").value = ATENDENTE;
PIN ? iniciar() : $("login").classList.remove("oculto");
