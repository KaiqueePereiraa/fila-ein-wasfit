// Endereço da edge function no Supabase (preenchido no deploy).
window.FILA_API = "https://zgsmhzgvlcfwhbhhjigw.supabase.co/functions/v1/fila";

window.api = async function (acao, dados = {}, pin) {
  const headers = { "Content-Type": "application/json" };
  if (pin) headers["x-painel-pin"] = pin;
  const r = await fetch(window.FILA_API, {
    method: "POST",
    headers,
    body: JSON.stringify({ acao, ...dados }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(body.erro || "Falha de conexão.");
    e.status = r.status;
    throw e;
  }
  return body;
};
