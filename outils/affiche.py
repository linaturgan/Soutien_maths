"""Génère un PDF A4 avec un QR code vectoriel et un lien cliquable."""

import argparse
from pathlib import Path
from urllib.parse import urlsplit

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


def create_poster(url, path):
    width, height = A4
    ink = HexColor("#192D24")
    green = HexColor("#24583E")
    gold = HexColor("#EECE7D")
    paper = HexColor("#F8F7F2")

    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = Canvas(str(path), pagesize=A4)
    pdf.setTitle("Soutien maths au lycée - Inscriptions")
    pdf.setFillColor(paper)
    pdf.rect(0, 0, width, height, fill=1, stroke=0)

    pdf.setFillColor(ink)
    pdf.roundRect(39, height - 259, width - 78, 216, 22, fill=1, stroke=0)
    pdf.setFillColor(gold)
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(65, height - 94, "LYCÉE  /  INSCRIPTIONS")
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 48)
    pdf.drawString(62, height - 156, "Soutien maths")
    pdf.setFont("Helvetica", 15)
    pdf.drawString(65, height - 196, "Une question, un exercice ou une notion à revoir ?")
    pdf.drawString(65, height - 221, "Choisis les séances qui te conviennent. Le soutien est facultatif.")

    pdf.setFillColor(ink)
    pdf.setFont("Helvetica-Bold", 22)
    pdf.drawCentredString(width / 2, 531, "Scanne pour t’inscrire")
    qr_size = 226
    qr = QrCodeWidget(url, barWidth=qr_size, barHeight=qr_size, barBorder=4, barLevel="M")
    drawing = Drawing(qr_size, qr_size)
    drawing.add(qr)
    qr_left = (width - qr_size) / 2
    pdf.setFillColor(white)
    pdf.rect(qr_left, 277, qr_size, qr_size, fill=1, stroke=0)
    renderPDF.draw(drawing, pdf, qr_left, 277)
    pdf.linkURL(url, (qr_left, 277, qr_left + qr_size, 277 + qr_size))

    pdf.setFillColor(green)
    pdf.roundRect(130, 210, width - 260, 41, 8, fill=1, stroke=0)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawCentredString(width / 2, 225, "Ouvrir la page d’inscription")
    pdf.linkURL(url, (130, 210, width - 130, 251))
    pdf.setFillColor(green)
    size = min(11, 11 * (width - 100) / stringWidth(url, "Helvetica", 11))
    pdf.setFont("Helvetica", size)
    pdf.drawCentredString(width / 2, 185, url)
    pdf.linkURL(url, (50, 179, width - 50, 199))

    pdf.setStrokeColor(HexColor("#C6D3C5"))
    pdf.line(60, 140, width - 60, 140)
    pdf.setFillColor(ink)
    pdf.setFont("Helvetica", 13)
    pdf.drawCentredString(width / 2, 106, "Renseigne ton nom, ton prénom et ta classe.")
    pdf.drawCentredString(width / 2, 84, "Choisis tes créneaux dans l’emploi du temps, puis valide.")
    pdf.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Adresse HTTPS publique de la page d’inscription")
    parser.add_argument(
        "--output", type=Path,
        default=Path(__file__).resolve().parent.parent / "output/pdf/affiche-inscription-soutien-maths.pdf",
    )
    args = parser.parse_args()
    target = urlsplit(args.url)
    if target.scheme != "https" or not target.hostname or any(char.isspace() for char in args.url):
        parser.error("Indique une URL HTTPS complète, sans espace.")
    create_poster(args.url, args.output)


if __name__ == "__main__":
    main()
