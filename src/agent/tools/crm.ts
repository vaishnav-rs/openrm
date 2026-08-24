import { getPrisma } from "../../db/prisma.js";
import type { AgentTool } from "../tool-types.js";

async function getOrCreateContact(phone: string) {
  const prisma = getPrisma();
  return prisma.contact.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });
}

const saveContact: AgentTool = {
  definition: {
    name: "save_contact",
    description:
      "Save or update the customer's name and/or a short free-text interest note. " +
      "The phone number is never supplied by you -- it is taken automatically from " +
      "the WhatsApp conversation. Call this as soon as you learn the customer's name.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The customer's name, as they told it to you.",
        },
        interest: {
          type: "string",
          description: "A short note about what the customer is interested in, if mentioned.",
        },
      },
      additionalProperties: false,
    },
  },
  async execute(args, ctx) {
    const prisma = getPrisma();
    const name = typeof args.name === "string" ? args.name.trim() : undefined;
    const interest = typeof args.interest === "string" ? args.interest.trim() : undefined;

    const contact = await getOrCreateContact(ctx.phone);
    if (name) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { name },
      });
    }
    if (interest) {
      await prisma.interest.create({
        data: { contactId: contact.id, label: interest },
      });
    }
    return `Saved contact info for ${ctx.phone}${name ? ` (name: ${name})` : ""}${
      interest ? ` (interest: ${interest})` : ""
    }.`;
  },
};

const logInterest: AgentTool = {
  definition: {
    name: "log_interest",
    description:
      "Log a specific product/service interest for the current customer, with an " +
      "optional note. Use this whenever the customer expresses interest in something " +
      "concrete, even if you already called save_contact.",
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Short label for the interest, e.g. 'wedding photography package'.",
        },
        notes: {
          type: "string",
          description: "Optional additional detail.",
        },
      },
      required: ["label"],
      additionalProperties: false,
    },
  },
  async execute(args, ctx) {
    const prisma = getPrisma();
    const label = typeof args.label === "string" ? args.label.trim() : "";
    if (!label) {
      return "log_interest requires a non-empty 'label'.";
    }
    const notes = typeof args.notes === "string" ? args.notes.trim() : undefined;
    const contact = await getOrCreateContact(ctx.phone);
    await prisma.interest.create({
      data: { contactId: contact.id, label, notes },
    });
    return `Logged interest "${label}" for ${ctx.phone}.`;
  },
};

const getContact: AgentTool = {
  definition: {
    name: "get_contact",
    description:
      "Fetch what is currently known about the customer you are talking to right now: " +
      "their name (if known) and their logged interests.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  async execute(_args, ctx) {
    const prisma = getPrisma();
    const contact = await prisma.contact.findUnique({
      where: { phone: ctx.phone },
      include: { interests: true },
    });
    if (!contact) {
      return JSON.stringify({ phone: ctx.phone, name: null, interests: [] });
    }
    return JSON.stringify({
      phone: contact.phone,
      name: contact.name,
      interests: contact.interests.map((i) => ({ label: i.label, notes: i.notes })),
    });
  },
};

const searchContacts: AgentTool = {
  definition: {
    name: "search_contacts",
    description:
      "Search known contacts by name or interest text. Only useful for business-side " +
      "lookups; typically not needed while replying to a single customer.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text to match against name/interests." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(args) {
    const prisma = getPrisma();
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return "search_contacts requires a non-empty 'query'.";
    const contacts = await prisma.contact.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { interests: { some: { label: { contains: query, mode: "insensitive" } } } },
        ],
      },
      include: { interests: true },
      take: 10,
    });
    return JSON.stringify(
      contacts.map((c) => ({
        phone: c.phone,
        name: c.name,
        interests: c.interests.map((i) => i.label),
      }))
    );
  },
};

export const crmTools: AgentTool[] = [saveContact, logInterest, getContact, searchContacts];
