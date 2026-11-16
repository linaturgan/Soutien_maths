"""Génère un PDF A4 avec un QR code vectoriel et un lien cliquable."""

import argparse
from pathlib import Path
from urllib.parse import urlsplit

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import registerFont, stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


def poster_font(filename, fallback):
    font_path = Path("/System/Library/Fonts/Supplemental") / f"{filename}.ttf"
    if not font_path.is_file():
        return fallback
    registerFont(TTFont(filename, str(font_path)))
    return filename


def create_poster(url, path):
    width, _ = A4
    ink = HexColor("#192D24")
    green = HexColor("#24583E")
    pale_green = HexColor("#DCEBDD")
    orange = HexColor("#B44523")
    title_font = poster_font("Georgia Bold", "Times-Bold")
    accent_font = poster_font("Georgia Italic", "Times-Italic")
    text_font = poster_font("Arial", "Helvetica")
    bold_font = poster_font("Arial Bold", "Helvetica-Bold")

    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = Canvas(str(path), pagesize=A4)
    pdf.setTitle("Soutien maths au lycée - Inscriptions")

    pdf.setFillColor(pale_green)
    pdf.roundRect(36, 516, width - 72, 283, 16, fill=1, stroke=0)
    pdf.setFillColor(ink)
    pdf.setFont(title_font, 49)
    pdf.drawCentredString(width / 2, 719, "Besoin de soutien")
    pdf.setFillColor(green)
    pdf.setFont(accent_font, 75)
    pdf.drawCentredString(width / 2, 642, "en maths ?")
    pdf.setFillColor(ink)
    pdf.setFont(text_font, 21)
    pdf.drawCentredString(width / 2, 588, "Des créneaux viennent d’ouvrir, ici au lycée,")
    pdf.drawCentredString(width / 2, 560, "avec Madame Owczarzak.")
    pdf.setFont(bold_font, 21)
    pdf.drawCentredString(width / 2, 529, "Pour t’inscrire, c’est par ici")

    qr_size = 246
    qr_bottom = 222
    qr_left = (width - qr_size) / 2
    qr = QrCodeWidget(url, barWidth=qr_size, barHeight=qr_size, barBorder=4, barLevel="M")
    drawing = Drawing(qr_size, qr_size)
    drawing.add(qr)
    pdf.setFillColor(white)
    pdf.setStrokeColor(pale_green)
    pdf.setLineWidth(1.4)
    pdf.roundRect(qr_left, qr_bottom, qr_size, qr_size, 14, fill=1, stroke=1)
    renderPDF.draw(drawing, pdf, qr_left, qr_bottom)
    pdf.linkURL(url, (qr_left, qr_bottom, qr_left + qr_size, qr_bottom + qr_size))

    pdf.setStrokeColor(orange)
    pdf.setLineWidth(3)
    pdf.setLineCap(1)
    pdf.setLineJoin(1)
    arrow = pdf.beginPath()
    arrow.moveTo(110, 501)
    arrow.curveTo(84, 481, 92, 435, 147, 420)
    arrow.lineTo(137, 435)
    arrow.moveTo(147, 420)
    arrow.lineTo(130, 415)
    pdf.drawPath(arrow)

    pdf.setFillColor(green)
    pdf.setStrokeColor(green)
    size = min(15, 15 * (width - 100) / stringWidth(url, text_font, 15))
    pdf.setFont(text_font, size)
    text_width = stringWidth(url, text_font, size)
    pdf.drawCentredString(width / 2, 181, url)
    pdf.setLineWidth(0.65)
    pdf.line((width - text_width) / 2, 178, (width + text_width) / 2, 178)
    pdf.linkURL(url, ((width - text_width) / 2, 174, (width + text_width) / 2, 197))

    pdf.setFillColor(ink)
    pdf.setFont(bold_font, 22)
    pdf.drawCentredString(width / 2, 112, "Choisis tes créneaux,")
    pdf.setFillColor(orange)
    pdf.setFont(accent_font, 42)
    pdf.drawCentredString(width / 2, 65, "sans limite !")
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
