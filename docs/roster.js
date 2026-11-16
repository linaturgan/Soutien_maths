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

function* renderRosterPages(sections) {
  const pageCount = sections.reduce((count, { list }) => count + Math.max(1, Math.ceil(list.length / rowsPerPage)), 0);
  const canvas = document.createElement('canvas');
  const scale = 3;
  canvas.width = Math.ceil(pageWidth * scale);
  canvas.height = Math.ceil(pageHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  let pageNumber = 0;
  for (const { list, description } of sections) {
    const count = Math.max(1, Math.ceil(list.length / rowsPerPage));
    for (let index = 0; index < count; index++) {
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
      ctx.fillText('Page ' + (++pageNumber) + ' / ' + pageCount, columns[0], pageHeight - 29);
      yield canvas.toDataURL('image/png');
    }
  }
}

async function rosterPdf(sections) {
  const { PDFDocument } = globalThis.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle('Listes d’appel · Soutien maths');
  for (const pageImage of renderRosterPages(sections)) {
    const image = await pdf.embedPng(pageImage);
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

export async function downloadRoster(sections, filename) {
  const url = URL.createObjectURL(await rosterPdf(sections));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function viewRoster(sections, tab) {
  const blob = await rosterPdf(sections);
  if (tab.closed) return;
  const url = URL.createObjectURL(blob);
  tab.location.replace(url);
  const timer = setInterval(() => {
    if (tab.closed) {
      clearInterval(timer);
      URL.revokeObjectURL(url);
    }
  }, 5000);
}

export async function printRoster(sections, tab) {
  if (tab.closed) return;
  const doc = tab.document;
  doc.title = 'Liste d’appel · Soutien maths';
  const styles = doc.createElement('style');
  styles.textContent = `
    @page { size: A4 portrait; margin: 0; }
    body { margin: 0; background: white; }
    img { display: block; width: 100%; max-width: 210mm; margin: auto; break-inside: avoid; }
    img + img { break-before: page; page-break-before: always; }
    @media print { img { max-width: 209mm; } }
  `;
  doc.head.append(styles);
  doc.body.replaceChildren();
  const images = [];
  for (const pageImage of renderRosterPages(sections)) {
    const image = doc.createElement('img');
    image.alt = 'Liste d’appel';
    image.src = pageImage;
    doc.body.append(image);
    images.push(image.decode());
  }
  await Promise.all(images);
  if (!tab.closed) {
    tab.focus();
    tab.print();
  }
}
