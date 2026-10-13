const alvo = new URL("./", location.href).href;
  document.getElementById("url").textContent = alvo.replace(/^https?:\/\//, "");
  new QRCode(document.getElementById("qr"), { text: alvo, width: 640, height: 640, colorDark: "#01040a", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
document.getElementById("imprimir").addEventListener("click", () => print());
