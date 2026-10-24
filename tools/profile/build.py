"""Build the public CV and research overview: python tools/profile/build.py.

Requires ReportLab only; these are static downloads, independent of the site build.
Content is deliberately limited to public results and confirmed biographical facts.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public" / "profile"
UPDATED = "24 October 2026"
INK = colors.HexColor("#202b36")
NAVY = colors.HexColor("#173b55")
MUTED = colors.HexColor("#52616c")
RULE = colors.HexColor("#c4d1d9")
# Platypus frames have six points of inner padding on each side.
WIDTH = A4[0] - 36 * mm - 12

BODY = ParagraphStyle(
    "body", fontName="Helvetica", fontSize=10.3, leading=13.6,
    textColor=INK, spaceAfter=6,
)
SMALL = ParagraphStyle(
    "small", parent=BODY, fontSize=9.2, leading=12, textColor=MUTED,
)
TITLE = ParagraphStyle(
    "title", parent=BODY, fontName="Helvetica-Bold", fontSize=27,
    leading=31, textColor=NAVY, spaceAfter=6,
)
SUBTITLE = ParagraphStyle(
    "subtitle", parent=BODY, fontSize=12.3, leading=16, spaceAfter=5,
)
SECTION = ParagraphStyle(
    "section", parent=BODY, fontName="Helvetica-Bold", fontSize=12.2,
    leading=16, textColor=NAVY, spaceBefore=9, spaceAfter=4,
    keepWithNext=True,
)
ENTRY = ParagraphStyle(
    "entry", parent=BODY, fontName="Helvetica-Bold", spaceAfter=2,
)
DATE = ParagraphStyle("date", parent=SMALL, alignment=TA_RIGHT, spaceAfter=2)


def p(text, style=BODY):
    return Paragraph(text, style)


def link(url, label):
    return f'<link href="{url}" color="#173b55"><u>{label}</u></link>'


def section(title):
    return [p(title, SECTION), HRFlowable(width="100%", thickness=0.45,
                                         color=RULE, spaceAfter=6)]


def entry(title, date, description):
    row = Table([[p(title, ENTRY), p(date, DATE)]],
                colWidths=[WIDTH * 0.76, WIDTH * 0.24])
    row.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return KeepTogether([row, p(description)])


def header(subtitle):
    return [
        p("Colin Blake", TITLE),
        p(subtitle, SUBTITLE),
        p("MOCQUA, Inria / Université de Lorraine, LORIA - Nancy, France"),
        p(link("mailto:colin.blake@inria.fr", "colin.blake@inria.fr")
          + " &nbsp; | &nbsp; "
          + link("https://www.colin-blake.eu/", "colin-blake.eu"), SMALL),
        Spacer(1, 3),
    ]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(18 * mm, 15 * mm, A4[0] - 18 * mm, 15 * mm)
    canvas.setFont("Helvetica", 8.2)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10.5 * mm, f"Colin Blake | Updated {UPDATED}")
    canvas.drawRightString(A4[0] - 18 * mm, 10.5 * mm, str(doc.page))
    canvas.restoreState()


def build(filename, title, story):
    doc = SimpleDocTemplate(
        str(OUTPUT / filename), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=15 * mm, bottomMargin=20 * mm,
        title=f"Colin Blake - {title}", author="Colin Blake",
        subject="Quantum-circuit equational theories", lang="en-GB",
        pageCompression=1, invariant=1,
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def cv():
    story = header("PhD researcher in quantum computing")
    story += section("Research")
    story += [p("Equational theories for quantum circuits: qudits, controlled operations, "
                "phase-affine fragments, normal forms and rewriting methods for compilation.")]

    story += section("Education")
    story += [
        entry("PhD in Computer Science", "Oct 2024-present",
              "Université de Lorraine, MOCQUA (Inria / LORIA). Expected completion: 2027.<br/>"
              "Thesis: <i>Reasoning with and Optimising Quantum Circuits.</i><br/>"
              "Supervisors: Simon Perdrix and Miriam Backens."),
        entry("Master Parisien de Recherche en Informatique (MPRI)", "2022-2024",
              "M2: ENS Paris-Saclay, 2023-2024, <i>Mention Bien.</i><br/>"
              "M1: Université Paris-Saclay, 2022-2023."),
        entry("Magistère d'Informatique", "2021-2024",
              "Université Paris-Saclay. University diploma alongside the L3-M2 pathway."),
        entry("Licence Double Diplôme, Mathematics and Computer Science", "2019-2022",
              "Université Paris-Saclay. <i>Mention Très Bien.</i>"),
    ]

    story += section("Publications")
    story += [
        p("<b>A Complete Equational Presentation of Qudit Circuits via Polycontrolled PROPs.</b><br/>"
          "Colin Blake. MFCS 2026, LIPIcs 386, 6:1-6:18. <b>Best Student Paper Award.</b><br/>"
          + link("https://doi.org/10.4230/LIPIcs.MFCS.2026.6", "doi:10.4230/LIPIcs.MFCS.2026.6")),
        p("<b>Simpler Presentations for Many Fragments of Quantum Circuits.</b><br/>"
          "Colin Blake. FSCD 2026, LIPIcs 378, 6:1-6:20.<br/>"
          + link("https://doi.org/10.4230/LIPIcs.FSCD.2026.6", "doi:10.4230/LIPIcs.FSCD.2026.6")),
    ]
    story += section("Preprint")
    story += [p("<b>Completeness for Prime-Dimensional Phase-Affine Circuits.</b><br/>"
                "Colin Blake. 2026. "
                + link("https://arxiv.org/abs/2603.06466", "arXiv:2603.06466") + ".")]

    story += section("Research internships")
    story += [
        entry("M2 - Inria MOCQUA, Nancy", "Mar-Jul 2024",
              "Equational theories of qudit circuits. Supervisor: Simon Perdrix."),
        entry("M1 - Inria QuaCS, Orsay", "Mar-Jul 2023",
              "ZX-calculus fragments with partial transpose. Supervisor: Renaud Vilmart."),
        entry("L3 - LMF QuaCS, Orsay", "May-Jul 2022",
              "Typed quantum-circuit compilation and ZX-calculus pattern matching.<br/>"
              "Supervisor: Kostia Chardonnet."),
        PageBreak(),
    ]

    story += section("Awards and scholarships")
    story += [
        p("<b>2026 - France Excellence Quantum scholarship</b> for a research visit to the University of Amsterdam."),
        p("<b>2026 - Best Student Paper Award, MFCS</b>, for the paper on polycontrolled PROPs."),
        p("<b>2025 - First Jury Prize, Scientific Game Jam Nancy</b>, with the team behind <i>Les Chevaliers du Quantique.</i>"),
        p("<b>2022-2023 - Labex DigiCosme Excellence Scholarship</b>, M1 MPRI."),
    ]

    story += section("Teaching")
    story += [
        entry("Tutorial instructor - Mines Nancy", "2026-2027",
              "Tutorials and practical classes since September 2026: Algorithms and Complexity; Python for Engineers."),
        entry("Practical-class instructor - Université de Lorraine", "Sep 2025-Aug 2026",
              "Java software project (24 h); Introduction to Artificial Intelligence (22 h); Introduction to Algorithms (18 h)."),
        entry("Practical-class instructor - Université de Lorraine", "Feb-Aug 2025",
              "Java software project (24 h); Introduction to Artificial Intelligence (12 h)."),
        p("Supervised practical classes and projects, contributed to AI project design, and assessed assigned student groups."),
    ]

    story += section("Invited talks and selected presentations")
    story += [
        p("<b>MFCS 2026</b>, Paris, 27 August 2026; <b>QPL 2026</b>, Amsterdam, 17 August 2026; <b>FSCD 2026</b>, Lisbon, 23 July 2026: presentations of the papers listed above."),
        p("<b>Invited seminar, Marne-la-Vallée</b>, 26 November 2025: <i>Quantum computing and ZX-calculus.</i>"),
    ]

    story += section("Science outreach")
    story += [
        p("<b>Les Chevaliers du Quantique (2025).</b> Designed the original circuit-simplification game and the mechanics of its team-developed video-game adaptation."),
        p("<b>Fête de la Science</b>, Nancy, 10-11 October 2025: public quantum-circuit workshops using the game."),
        p("<b>Cap sur le numérique à Bercy</b>, Paris, 8 December 2025: quantum research and research careers."),
    ]

    story += section("Research software")
    story += [
        p("<b>" + link("https://github.com/Sukyn/minimality-auto/", "minimality-auto")
          + " (Python).</b> Command-line search for invariants separating an equation from the other axioms of a quantum-circuit theory."),
        p("<b>Tools:</b> Why3, Git, UML, unit testing."),
    ]
    story += section("Languages")
    story += [p("French: native. English: full professional proficiency. Spanish: professional working proficiency.")]
    build("colin-blake-cv.pdf", "Curriculum vitae", story)


def overview():
    story = header("Research overview | Equational theories for quantum circuits")
    story += [p("I study which equations suffice to prove that two quantum circuits implement "
                "the same operation. My work concerns qudits, controlled operations and circuit "
                "fragments, using categorical presentations, normal forms and rewriting.")]

    story += section("Selected results")
    story += [
        p("<b>Exact qudit circuits in every finite dimension.</b><br/>"
          "A finite family of local axiom schemata gives a sound and complete equational "
          "theory for exact unitary circuits in every dimension at least two. Primitive "
          "value-control makes controlled operations part of the circuit language; the "
          "diagrammatic shapes of the rules do not depend on the dimension."),
        p("<i>A Complete Equational Presentation of Qudit Circuits via Polycontrolled PROPs.</i><br/>"
          "MFCS 2026 - <b>Best Student Paper Award.</b> "
          + link("https://doi.org/10.4230/LIPIcs.MFCS.2026.6", "Paper and DOI"), SMALL),
        Spacer(1, 5),
        p("<b>Simpler rule sets for circuit fragments.</b><br/>"
          "Six near-Clifford fragments share a PROP treatment with structural wire "
          "permutations. Completeness transfers from earlier presentations, while separating "
          "interpretations show which remaining rules are indispensable. Minimality holds "
          "in all arities for qubit Clifford, real Clifford and CNOT-dihedral circuits, "
          "and in bounded ranges for the other fragments."),
        p("<i>Simpler Presentations for Many Fragments of Quantum Circuits.</i><br/>"
          "FSCD 2026. " + link("https://doi.org/10.4230/LIPIcs.FSCD.2026.6", "Paper and DOI"), SMALL),
        Spacer(1, 5),
        p("<b>Phase-affine normal forms for prime-dimensional qudits.</b><br/>"
          "A complete equational theory extends reversible affine circuits with "
          "bounded-degree diagonal phase polynomials over prime fields. Unique "
          "phase-affine normal forms connect semantic circuit equality to derivable "
          "equality, generalising the role of phase polynomials in CNOT-dihedral circuits."),
        p("<i>Completeness for Prime-Dimensional Phase-Affine Circuits.</i><br/>"
          "Preprint, 2026. " + link("https://arxiv.org/abs/2603.06466", "arXiv:2603.06466"), SMALL),
    ]

    story += section("Research software")
    story += [p("<b>" + link("https://github.com/Sukyn/minimality-auto/", "minimality-auto")
                + ".</b> A Python command-line tool for searching for invariants that separate "
                "one equation from the rest of a supplied complete theory. Bundled theories, "
                "examples and JSON output support reproducible bounded searches. Exact "
                "combinatorial witnesses are distinguished from floating-point numerical "
                "evidence; an unsuccessful search does not establish derivability.")]

    story += section("Doctoral research")
    story += [p("PhD in Computer Science, Université de Lorraine, MOCQUA (Inria / LORIA), "
                "since October 2024. Supervisors: Simon Perdrix and Miriam Backens. "
                "Expected completion: 2027."),
              p("Publications and talks: "
                + link("https://www.colin-blake.eu/publications", "colin-blake.eu/publications"), SMALL)]
    build("research-overview.pdf", "Research overview", story)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cv()
    overview()
    print("Built public/profile/colin-blake-cv.pdf and research-overview.pdf")
