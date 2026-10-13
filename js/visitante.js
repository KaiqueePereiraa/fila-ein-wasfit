const $ = (id) => document.getElementById(id);
const CHAVE = "fila-wasfit-id";
const ler = () => { try { return localStorage.getItem(CHAVE); } catch { return null; } };
const gravar = (v) => { try { v ? localStorage.setItem(CHAVE, v) : localStorage.removeItem(CHAVE); } catch {} };

const abriuEm = Date.now();
let meuId = new URLSearchParams(location.search).get("t") || ler();
let timer, relogio;

function mostrar(tela) {
  for (const t of ["cadastro", "fila", "vez", "fim"]) $("tela-" + t).classList.toggle("oculto", t !== tela);
}

// Máscara simples de telefone BR
$("telefone").addEventListener("input", (e) => {
  let d = e.target.value.replace(/\D/g, "").slice(0, 11);
  if (d.length > 6) e.target.value = `(${d.slice(0,2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
  else if (d.length > 2) e.target.value = `(${d.slice(0,2)}) ${d.slice(2)}`;
  else e.target.value = d;
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("erro").textContent = "";
  const dados = Object.fromEntries(new FormData(e.target));
  if (!dados.nome.trim()) return ($("erro").textContent = "Informe seu nome.");
  if (dados.telefone.replace(/\D/g, "").length < 10) return ($("erro").textContent = "Informe o WhatsApp com DDD.");
  if (!$("aceite").checked) return ($("erro").textContent = "Precisamos do seu aceite para te chamar no WhatsApp.");
  $("enviar").disabled = true; $("enviar").textContent = "Entrando…";
  try {
    const r = await api("entrar", { ...dados, tempo_ms: Date.now() - abriuEm });
    meuId = r.id; gravar(meuId);
    history.replaceState(null, "", "?t=" + meuId);
    await atualizar();
  } catch (err) {
    $("erro").textContent = err.message;
  } finally {
    $("enviar").disabled = false; $("enviar").textContent = "Entrar na fila";
  }
});

$("nova").addEventListener("click", () => {
  gravar(null); meuId = null; clearTimeout(timer);
  history.replaceState(null, "", location.pathname);
  $("form").reset(); $("aceite").checked = true;
  mostrar("cadastro");
});

function contagem(chamadoEm, tolerancia) {
  clearInterval(relogio);
  const fim = Date.parse(chamadoEm) + tolerancia * 60000;
  const tick = () => {
    const s = Math.max(0, Math.round((fim - Date.now()) / 1000));
    $("relogio").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    $("relogio-txt").textContent = s ? "tempo para chegar ao stand" : "corre, ainda dá tempo! 🏃";
  };
  tick(); relogio = setInterval(tick, 1000);
}

let ultimoStatus;
async function atualizar() {
  clearTimeout(timer);
  if (!meuId) return mostrar("cadastro");
  try {
    const s = await api("status", { id: meuId });
    if (s.status === "aguardando") {
      $("ola").textContent = `Oi, ${s.nome}!`;
      const n = s.na_frente ?? 0;
      const proximo = n === 0;
      $("na-frente").textContent = proximo ? "Já já!" : n;
      $("na-frente").classList.toggle("pequeno", proximo);
      $("na-frente-txt").textContent = proximo ? "você é o(a) próximo(a)" : n === 1 ? "pessoa na sua frente" : "pessoas na sua frente";
      $("posicao").textContent = s.posicao ? s.posicao + "º" : "–";
      $("espera").textContent = s.espera_min ? `~${s.espera_min} min` : "–";
      $("dica").textContent = n <= 1
        ? "Falta pouco! Já pode ir se aproximando do stand da WasFit."
        : "Pode circular pela feira. Quando faltar pouco, te mandamos um aviso no WhatsApp pra você ir se aproximando.";
      $("dica").classList.toggle("alerta", n <= 1);
      $("tela-fila").querySelector(".cartao").classList.toggle("perto", n <= 1);
      mostrar("fila");
    } else if (s.status === "chamado") {
      if (ultimoStatus !== "chamado" && navigator.vibrate) navigator.vibrate([300, 150, 300]);
      contagem(s.chamado_em, s.tolerancia_min);
      mostrar("vez");
    } else {
      clearInterval(relogio);
      const atendido = s.status === "atendido" || s.status === "atendendo";
      $("fim-etq").textContent = atendido ? "Obrigado" : "Fila encerrada";
      $("fim-titulo").textContent = atendido ? `Valeu, ${s.nome}!` : "Sua vez foi liberada";
      $("fim-txt").textContent = atendido
        ? "Foi um prazer te receber no stand. Seguimos a conversa pelo WhatsApp."
        : "Não te encontramos quando chamamos. Se ainda quiser, entre na fila de novo.";
      mostrar("fim");
    }
    ultimoStatus = s.status;
  } catch (err) {
    if (err.status === 404) { gravar(null); meuId = null; return mostrar("cadastro"); }
  }
  timer = setTimeout(atualizar, 8000);
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && meuId) atualizar(); });
atualizar();
