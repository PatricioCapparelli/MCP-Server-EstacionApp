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
          text: "🚫 No se encontraron estacionamientos disponibles en la zona."
        }]
      };
    }

    // Procesamiento previo de datos
    const estacionamientos = data.instancias.map(est => {
      const contenido = est.contenido.contenido.reduce((acc, item) => {
        acc[item.nombreId] = item.valor;
        return acc;
      }, {});
      
      return {
        ...est,
        detalles: contenido
      };
    });

    const prompt = `Como experto en tránsito de CABA, analiza estos estacionamientos en formato claro y estructurado:

**Datos generales:**
- Total encontrados: ${data.total}
- Disponibles para estacionar: ${data.totalFull}

**Detalle por ubicación:**
${estacionamientos.map((est, i) => {
  const calle = est.detalles.calle || 'Calle no especificada';
  const altura = est.detalles.altura || 'S/N';
  const permiso = est.detalles.permiso || 'Sin datos';
  const horario = est.detalles.horario || 'Sin horario';
  const lado = est.detalles.lado || '';
  const distancia = est.distancia || 'N/D';

  return `
📍 ${i + 1}. ${calle} ${altura} (${lado})
- Tipo: ${permiso}
- Horario: ${horario}
- Distancia: ${distancia} metros
`;
}).join('')}

**Formato requerido para la respuesta:**
1. 🅿️ RESUMEN: Breve resumen de disponibilidad
2. ✅ UBICACIONES PERMITIDAS: Lista clara de calles y horarios donde se puede estacionar
3. 🚫 RESTRICCIONES: Zonas prohibidas o con limitaciones
4. 💡 RECOMENDACIÓN: Mejor opción basada en distancia y disponibilidad
5. 📌 OBSERVACIONES: Cualquier dato adicional relevante

**Sé conciso pero preciso, usando emojis para mejor legibilidad.**`;

    try {
      const response = await openai.chat.completions.create({
        model: "openai/gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "Eres un asistente especializado en movilidad urbana de Buenos Aires. Proporciona información clara y estructurada con emojis relevantes."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.3
      });

      const analysis = response.choices[0].message.content;
      console.log("Análisis generado:", analysis);

      return {
        content: [{ type: "text", text: analysis }],
        metadata: {
          totalEstacionamientos: data.total,
          estacionamientosPermitidos: estacionamientos.filter(e => 
            e.detalles.permiso?.includes('PERMITIDO')).length,
          estacionamientosProhibidos: estacionamientos.filter(e => 
            e.detalles.permiso?.includes('PROHIBIDO')).length
        }
      };
    } catch (error) {
      console.error("Error con OpenAI:", error);
      return {
        content: [{
          type: "text",
          text: `⚠️ Error al analizar los estacionamientos: ${error.message}`
        }],
        error: true
      };
    }
  }
});

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// Middleware para loggear requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Middleware para manejo de errores
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ 
    error: "Error interno del servidor",
    detalle: err.message 
  });
});

app.post("/mcp-tool/:toolName", async (req, res) => {
  const { toolName } = req.params;
  const { input } = req.body;

  console.log("Headers:", req.headers);
  console.log("Body completo recibido:", JSON.stringify(req.body, null, 2));

  if (!input || !input.data) {
    return res.status(400).json({ 
      error: "Formato incorrecto. Se espera { input: { data: {...} } }",
      ejemplo: {
        input: {
          data: {
            instancias: [],
            total: 0,
            totalFull: 0
          }
        }
      }
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
    
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error("Error en handler:", err);
    res.status(500).json({ 
      error: "Error interno al procesar la solicitud",
      detalle: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Health check mejorado
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    tools: Array.from(tools.keys()),
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    env: process.env.NODE_ENV
  };
  
  res.json(health);
});

// Endpoint de ejemplo
app.get('/ejemplo', (req, res) => {
  res.json({
    description: "Ejemplo de estructura esperada",
    request: {
      method: "POST",
      url: "/mcp-tool/analizar-estacionamiento",
      body: {
        input: {
          data: {
            instancias: [
              {
                nombre: "Permitido estacionar 24 horas",
                contenido: {
                  contenido: [
                    { nombreId: "calle", valor: "ECHAGUE, PEDRO" },
                    { nombreId: "altura", valor: "1301-1400" },
                    { nombreId: "permiso", valor: "PERMITIDO ESTACIONAR" },
                    { nombreId: "horario", valor: "24 HORAS" },
                    { nombreId: "lado", valor: "derecho" }
                  ]
                },
                distancia: "4.85"
              }
            ],
            total: 1,
            totalFull: 1
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  🚀 Servidor MCP listo en http://localhost:${PORT}
  
  Endpoints disponibles:
  - POST /mcp-tool/analizar-estacionamiento
  - GET /health
  - GET /ejemplo
  
  Variables de entorno requeridas:
  - OPENROUTER_API_KEY
  - PORT (opcional)
  `);
});