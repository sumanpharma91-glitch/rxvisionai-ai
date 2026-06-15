export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set in Vercel Environment Variables.' });
  }

  const { ocrText } = req.body || {};
  if (!ocrText || typeof ocrText !== 'string') {
    return res.status(400).json({ error: 'Missing ocrText.' });
  }

  const schema = {
    name: 'prescription_extraction',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        patient_name: { type: ['string','null'] },
        dob: { type: ['string','null'], description: 'ISO date YYYY-MM-DD when possible' },
        drug_name: { type: ['string','null'] },
        strength: { type: ['string','null'] },
        quantity: { type: ['string','null'] },
        refills: { type: ['string','null'] },
        directions: { type: ['string','null'] },
        prescriber: { type: ['string','null'] },
        prescription_date: { type: ['string','null'], description: 'ISO date YYYY-MM-DD when possible' },
        confidence_flags: { type: 'array', items: { type: 'string' } }
      },
      required: ['patient_name','dob','drug_name','strength','quantity','refills','directions','prescriber','prescription_date','confidence_flags']
    },
    strict: true
  };

  const prompt = `You are a Canadian pharmacy prescription intake parser.

Task: Convert raw OCR text from a prescription image into structured prescription fields.

Rules:
- Ignore clinic headers, addresses, phone/fax numbers, websites, copyright text, EMR/footer text, and unrelated administrative text.
- Do not guess. If a field is not clearly present, return null.
- Never use sample or placeholder values.
- Correct obvious OCR errors only when highly likely, such as Lazenge -> Lozenge, IManth -> 1 Month.
- Keep pharmacist verification required.
- Add confidence_flags for uncertain, missing, or safety-relevant items.

Raw OCR text:
${ocrText}`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        input: [
          { role: 'system', content: 'Return JSON only using the provided schema. You are not a clinical decision maker.' },
          { role: 'user', content: prompt }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: schema.name,
            schema: schema.schema,
            strict: true
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'OpenAI API error', details: data });
    }

    const textOutput = data.output_text || data.output?.[0]?.content?.[0]?.text;
    const extraction = typeof textOutput === 'string' ? JSON.parse(textOutput) : textOutput;
    return res.status(200).json({ extraction });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
