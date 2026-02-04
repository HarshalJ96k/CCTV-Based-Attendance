import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: "Missing Supabase credentials" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  try {
    // 🟢 Node 22 fix: manually parse the request body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString();
    const body = JSON.parse(rawBody || "{}");

    const { name, roll_no } = body;

    if (!name || !roll_no) {
      return res.status(400).json({ error: "Missing name or roll_no" });
    }

    const { data, error } = await supabase.from("attendance").insert([
      {
        name,
        roll_no,
        recorded_at: new Date().toISOString(),
        source: "webcam",
      },
    ]);

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("Serverless Error:", e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
