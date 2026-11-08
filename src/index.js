// The Worker serves the static page from ./public.
// It also handles POST /api/contact: it checks the form fields and sends one email.

const MAX = { name: 100, email: 200, organization: 150, message: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function handleContact(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "The form data is not valid." }, 400);
  }

  const field = (k) => String(form.get(k) ?? "").trim();
  const data = {
    name: field("name"),
    email: field("email"),
    organization: field("organization"),
    message: field("message"),
  };

  // A hidden field that people do not see. Bots often fill it in.
  // Return success so that the bot does not try again.
  if (field("website")) return json({ ok: true });

  if (!data.name || !data.email || !data.message) {
    return json({ ok: false, error: "Please fill in your name, email, and message." }, 400);
  }
  if (!EMAIL_RE.test(data.email)) {
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  }
  for (const [k, limit] of Object.entries(MAX)) {
    if (data[k].length > limit) {
      return json({ ok: false, error: `The ${k} field is too long.` }, 400);
    }
  }

  // Remove line breaks from values that go into email headers.
  const oneLine = (s) => s.replace(/[\r\n]+/g, " ");
  const subjectName = oneLine(data.name).slice(0, 80);

  const text = [
    "New contact form message from the THIA website.",
    "",
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Organization: ${data.organization || "(none)"}`,
    "",
    "Message:",
    data.message,
  ].join("\n");

  const html = `
    <p>New contact form message from the THIA website.</p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(data.name)}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(data.email)}</td></tr>
      <tr><td><strong>Organization</strong></td><td>${escapeHtml(data.organization || "(none)")}</td></tr>
    </table>
    <p><strong>Message</strong></p>
    <p style="white-space:pre-wrap">${escapeHtml(data.message)}</p>`;

  try {
    await env.EMAIL.send({
      to: env.CONTACT_TO,
      from: { email: env.CONTACT_FROM, name: "THIA Website" },
      replyTo: oneLine(data.email),
      subject: `THIA contact form: ${subjectName}`,
      text,
      html,
    });
  } catch (err) {
    console.error("Email send failed", err?.code, err?.message);
    return json({ ok: false, error: "We could not send your message. Please try again later." }, 502);
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Send plain http:// visitors to the https:// address.
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/api/contact") {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
      return handleContact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
