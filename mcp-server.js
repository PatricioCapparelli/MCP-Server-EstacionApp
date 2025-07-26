import express from "express";
import bodyParser from "body-parser";
import { OpenAI } from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const tools = new Map();

tools.set("analizar-estacionamiento", {
  handler: async ({ data }) => {
    console.log("Datos recibidos completos:", JSON.stringify(data, null, 2));
    
    if (!data.instancias || data.instancias.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No se encontraron estacionamientos disponibles en la zona."
        }]
      };
    }

    const prompt = `Como experto en tránsito de CABA, analiza estos estacionamientos:
- Total encontrados: ${data.total}
- Disponibles: ${data.totalFull}

Detalles por estacionamiento:
${data.instancias.map((est, i) => `
${i + 1}. ${est.nombre || 'Sin nombre'}
- Dirección: ${est.domicilio || 'No especificada'}
- Tarifa: ${est.tarifa || 'No especificada'}
- Capacidad: ${est.capacidad || '?'}
- Disponibles: ${est.disponibles || '?'}
`).join('')}

Responde con:
1. RESUMEN: 1 línea con disponibilidad general
2. RECOMENDACIÓN: Estacionamiento más conveniente
3. ADVERTENCIAS: Si hay restricciones importantes
4. DETALLES: Info adicional relevante
5. CALLES: direcciones de calles donde esta permitido o prohibido`;


    try {
      const response = await openai.chat.completions.create({
        model: "openai/gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "Eres un asistente especializado en movilidad urbana de Buenos Aires. Sé conciso pero útil."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.3
      });

      const analysis = response.choices[0].message.content;
      console.log("Análisis generado:", analysis);

      return {
        content: [{ type: "text", text: analysis }]
      };
    } catch (error) {
      console.error("Error con OpenAI:", error);
      return {
        content: [{
          type: "text",
          text: `⚠️ Error al analizar: ${error.message}`
        }]
      };
    }
  }
});

const app = express();
app.use(bodyParser.json({ limit: '10mb' })); // Aumentamos el límite para JSON grandes

// Middleware para loggear requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.post("/mcp-tool/:toolName", async (req, res) => {
  const { toolName } = req.params;
  const { input } = req.body;

  console.log("Headers:", req.headers);
  console.log("Body completo recibido:", JSON.stringify(req.body, null, 2));

  if (!input || !input.data) {
    return res.status(400).json({ 
      error: "Formato incorrecto. Se espera { input: { data: {...} } }" 
    });
  }

  if (!tools.has(toolName)) {
    return res.status(404).json({ 
      error: "Herramienta no encontrada",
      herramientasDisponibles: Array.from(tools.keys()) 
    });
  }

  try {
    const startTime = Date.now();
    const result = await tools.get(toolName).handler(input);
    console.log(`Tiempo de procesamiento: ${Date.now() - startTime}ms`);
    
    res.json(result);
  } catch (err) {
    console.error("Error en handler:", err);
    res.status(500).json({ 
      error: "Error interno al procesar la solicitud",
      detalle: err.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    tools: Array.from(tools.keys()),
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  🚀 Servidor listo en http://localhost:${PORT}
  Herramientas disponibles:
  - POST /mcp-tool/analizar-estacionamiento
  - GET /health
  `);
});