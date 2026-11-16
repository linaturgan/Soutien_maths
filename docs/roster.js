import './vendor/pdf-lib.min.js';

const pageWidth = 595.28;
const pageHeight = 841.89;
const columns = [38, 212, 386, 493, 557];
const padding = 9;
const rowHeight = 27;
const rowsPerPage = 23;

function fitText(ctx, text, width, fontSize, minSize = 4.5) {
  ctx.font = fontSize + 'px sans-serif';
  const measured = ctx.measureText(text).width;
  if (measured > width) ctx.font = Math.max(minSize, fontSize * width / measured) + 'px sans-serif';
}

async function downloadRoster(list, description, date) {
  const { PDFDocument } = globalThis.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle('Liste d’appel · Soutien maths');
  const pageCount = Math.max(1, Math.ceil(list.length / rowsPerPage));
  const canvas = document.createElement('canvas');
  const scale = 3;
  canvas.width = Math.ceil(pageWidth * scale);
  canvas.height = Math.ceil(pageHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  for (let index = 0; index < pageCount; index++) {
    const students = list.slice(index * rowsPerPage, (index + 1) * rowsPerPage);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageWidth, pageHeight);
    ctx.fillStyle = '#192d24';
    ctx.font = 'bold 25px sans-serif';
    ctx.fillText('Soutien maths · Liste d’appel', columns[0], 50);
    fitText(ctx, description, columns.at(-1) - columns[0], 12);
    ctx.fillText(description, columns[0], 79);
    ctx.font = '10px sans-serif';
    ctx.fillText(list.length + (list.length === 1 ? ' élève inscrit' : ' élèves inscrits'), columns[0], 101);
    const tableTop = 122;
    ctx.fillStyle = '#e6efe3';
    ctx.fillRect(columns[0], tableTop, columns.at(-1) - columns[0], rowHeight);
    ctx.fillStyle = '#192d24';
    ctx.font = 'bold 11px sans-serif';
    ['Nom', 'Prénom', 'Classe', 'Présence'].forEach((label, i) =>
      ctx.fillText(label, columns[i] + padding, tableTop + rowHeight / 2));
    const tableRows = Math.max(students.length, 8);
    for (const [i, student] of students.entries()) {
      const y = tableTop + rowHeight * (i + 1.5);
      [student.family, student.given, student.classroom].forEach((text, j) => {
        const width = columns[j + 1] - columns[j] - 2 * padding;
        fitText(ctx, text, width, 11);
        ctx.fillText(text, columns[j] + padding, y, width);
      });
      ctx.strokeStyle = '#829288';
      ctx.lineWidth = .65;
      ctx.strokeRect(columns[3] + (columns[4] - columns[3] - 10) / 2, y - 5, 10, 10);
    }
    ctx.strokeStyle = '#829288';
    ctx.lineWidth = .65;
    ctx.beginPath();
    for (const x of columns) {
      ctx.moveTo(x, tableTop);
      ctx.lineTo(x, tableTop + (tableRows + 1) * rowHeight);
    }
    for (let row = 0; row <= tableRows + 1; row++) {
      const y = tableTop + row * rowHeight;
      ctx.moveTo(columns[0], y);
      ctx.lineTo(columns.at(-1), y);
    }
    ctx.stroke();
    ctx.font = '10px sans-serif';
    ctx.fillText('Page ' + (index + 1) + ' / ' + pageCount, columns[0], pageHeight - 29);
    const image = await pdf.embedPng(canvas.toDataURL('image/png'));
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }

  const bytes = await pdf.save();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'appel-soutien-maths-' + date + '.pdf';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export { downloadRoster };
