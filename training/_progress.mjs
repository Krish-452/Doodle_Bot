import fs from "fs";
const logPath = process.argv[2];
const log = fs.readFileSync(logPath, "utf-8");
const lines = log.split("\n");
const epochs = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^Epoch (\d+)\/(\d+)/);
  if (m) {
    const dataLine = lines[i + 1] || "";
    const dm = dataLine.match(/accuracy: ([\d.]+) - loss: ([\d.]+) - val_accuracy: ([\d.]+) - val_loss: ([\d.]+)/);
    epochs.push({ n: +m[1], total: +m[2], acc: dm ? +dm[1] : null, valAcc: dm ? +dm[3] : null });
  }
}
const total = epochs.length ? epochs[0].total : 15;
console.log("Training progress:");
for (const e of epochs) {
  const filled = Math.round((e.n / total) * 30);
  const bar = "#".repeat(filled) + "-".repeat(30 - filled);
  const acc = e.valAcc !== null ? (e.valAcc * 100).toFixed(1) + "%" : "...";
  console.log("Epoch " + String(e.n).padStart(2) + "/" + total + " [" + bar + "] val_acc=" + acc);
}
const done = epochs.filter((e) => e.valAcc !== null).length;
const filled = Math.round((done / total) * 30);
console.log();
console.log("Overall  [" + "#".repeat(filled) + "-".repeat(30 - filled) + "] " + done + "/" + total + " epochs complete");
