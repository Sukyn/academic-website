export type TalkAppearance = {
  date?: string;
  event?: string;
};

export type Talk = {
  id: string;
  title: string;
  date?: string;
  event?: string;
  appearances?: TalkAppearance[];
  slidesHref?: string;
  abstract: string;
};

export const talks: Talk[] = [
  {
    id: "escape-the-matrix",
    title: "Escape the Matrix: Graphical Reasoning and Minimal Axioms for Quantum Circuits",
    date: "2025-05-06",
    event: "Département des méthodes formelles PhD Day - Nancy",
    slidesHref: "/notes/presentation-minimality.pdf",
    abstract:
      "Quantum circuits are commonly represented using matrices, but this approach becomes unwieldy for complex systems. In this talk, I will present a graphical methodology that utilizes equational rules to rewrite circuits, offering a more intuitive and structured framework. We will discuss the criteria for such a system to be sound, complete, and minimal, and explore the significance of these properties. Subsequently, I will introduce new minimal equational theories for various classes of quantum circuits, each with distinct expressive capabilities. These minimality results are significant because they simplify the equational theory by eliminating redundant rules, making it more practical for applications like circuit optimization and verification. No prior background in quantum computing is required; the emphasis will be on the foundational formal concepts.",
  },
  {
    id: "quantum-computing-and-zx-calculus",
    title: "Quantum computing and ZX-calculus",
    date: "2025-11-26",
    event: "Séminaires Jeunes chercheurs et chercheuses - Marne la Vallée",
    slidesHref: "/notes/zx-calculus-is-graphs.pdf",
    abstract:
      "What if we could picture quantum computations not as daunting complex matrices, but as simple graphs of nodes and wires? The ZX-calculus offers exactly that: a rigorous graphical language where any quantum circuit can be represented as a network of connected nodes. In this interactive talk, I will introduce the basics of ZX-calculus in an accessible way. We'll start with a quick refresher on quantum computing, with no prior quantum background required, then see how these concepts translate into colorful ZX-diagrams. Using a handful of intuitive graph transformation rules, we will visually simplify and reason about quantum circuits, almost like solving a puzzle. For example, we'll demonstrate how the famous quantum teleportation protocol, when depicted in ZX form, collapses into a trivially simple diagram, revealing its essence at a glance. Along the way, a few fun quiz questions via Kahoot! will test and engage your intuition. Beyond the fun, we will discuss why this graphical approach is powerful for research. The ZX-calculus provides a sound framework for optimizing quantum programs and verifying algorithm correctness, and it even reveals surprising connections to combinatorics and algebra: its rewrite rules mirror an underlying Hopf algebra structure. I will also highlight current challenges and my ongoing work, in particular extending these diagrammatic techniques to qudits, quantum systems with more than two levels, an open problem at the frontier of quantum computing theory. By the end of the talk, you'll see quantum computing from a new angle and understand why one might say that \"quantum computing is just graphs.\"",
  },
  {
    id: "reasoning-for-qudit-circuits",
    title: "Reasoning for Qudit Circuits",
    appearances: [
      {
        date: "2026-03-26",
        event: "MOCQUA PhD Day - Nancy",
      },
      {
        date: "2026-05-13",
        event: "Department of Formal Methods PhD Day - Nancy",
      },
    ],
    slidesHref: "/notes/slides_phd_presentation_2026.pdf",
    abstract:
      "Quantum programs are most often represented as quantum circuits: sequences of gates acting on registers of quantum systems. But in practice, writing a circuit is only the beginning. To optimise code, adapt it to hardware constraints such as connectivity and mapping, and verify correctness, we need reliable ways to transform circuits while preserving their meaning. A convenient approach is equational reasoning: we specify a set of rewrite rules, or axioms, and use them to derive when two circuits are equivalent. My PhD focuses on extending this story beyond qubits, towards higher dimensions, and on making equational theories usable by reducing redundancy and organising rewrite systems around normal forms. In this talk I will first introduce the basic ideas of quantum circuits and explain why gate sets and circuit fragments play an important role in quantum software. I will then discuss how equational reasoning is used to reason about and optimise circuits, and how these ideas extend to higher-dimensional quantum systems. Finally, I will present some of my recent work on equational theories for different kinds of qudit circuits and explain how it fits into the broader goal of building practical tools for reasoning about quantum programs.",
  },
];
