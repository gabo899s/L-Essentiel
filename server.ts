import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

dotenv.config();

async function startServer() {
  const app = express();
  // Usa 8080 por defecto en producción (requerido por Hyperlift), o 3000 para entorno de desarrollo local.
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.NODE_ENV === 'production' ? 8080 : 3000);

  // Trust proxy for rate limiting behind reverse proxies (like Cloud Run or Hyperlift Nginx)
  app.set("trust proxy", 1);

  // Security headers setup
  app.use(helmet({
    contentSecurityPolicy: false, // Disabling strict CSP in preview as it can block Vite HMR and dynamic scripts
  }));

  // Rate Limiting (Protects API routes from spam & bot abuse)
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes window
    max: 100, // Limit each IP to 100 requests per window
    message: { error: "Demasiadas peticiones desde tu IP, por favor intenta en 15 minutos." }
  });

  const aiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, 
    max: 25, // AI endpoints are more expensive, strict limit per IP
    message: { error: "Has excedido el límite de consultas de IA." }
  });

  app.use(express.json());
  
  // Apply limiters carefully
  app.use("/api/", apiLimiter);

  // Email route configuration based on user instructions
  // We use different minimalist HTML templates for different email types.
  app.post("/api/send-email", async (req, res) => {
    try {
      const { to, subject, text, fromType, emailType, customData } = req.body;
      // If client sends raw `html`, we can still support it for backwards compatibility,
      // but we encourage using `emailType` and generating HTML server-side.
      let finalHtml = req.body.html || ""; 
           
      let user = '';
      let pass = '';
      let fromAddress = '';
      
      if (fromType === 'team') {
        user = 'team@maesrp.lat';
        pass = 'Imgn2019#';
        fromAddress = '"L\'Essentiel Team" <team@maesrp.lat>';
      } else if (fromType === 'hello') {
        user = 'hello@maesrp.lat';
        pass = 'Imgn2019#';
        fromAddress = '"L\'Essentiel Hello" <hello@maesrp.lat>';
      } else if (fromType === 'legal') {
        user = 'legal@maesrp.lat';
        pass = 'Imgn2019#';
        fromAddress = '"L\'Essentiel Legal" <legal@maesrp.lat>';
      } else if (fromType === 'no-reply') {
        user = 'no-reply@maesrp.lat';
        pass = 'Imgn2019#';
        fromAddress = '"L\'Essentiel" <no-reply@maesrp.lat>';
      } else {
        user = 'support@maesrp.lat';
        pass = 'Imgn2019#';
        fromAddress = '"L\'Essentiel Support" <support@maesrp.lat>';
      }

      // Minimalist Frame Generator
      const wrapHtml = (content: string) => `
        <div style="background-color: #F5F5F0; padding: 60px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; padding: 60px 40px; text-align: center;">
            <h1 style="font-family: Georgia, serif; font-style: italic; font-size: 36px; margin: 0 0 30px 0; color: #1a1a1a;">L'Essentiel</h1>
            ${content}
            <div style="border-top: 1px solid #f0f0f0; margin-top: 50px; padding-top: 30px; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #8e8e8e;">
              © ${new Date().getFullYear()} L'Essentiel / Todos los derechos reservados
            </div>
          </div>
        </div>
      `;

      // Assign explicit templates based on emailType
      if (emailType === "welcome") {
        finalHtml = wrapHtml(`
          <p style="font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #8e8e8e; margin: 0 0 40px 0;">BOUTIQUE MINIMALE</p>
          <p style="font-size: 16px; margin: 0 0 30px 0; color: #4a4a4a;">Gracias por unirte a nuestra comunidad.</p>
          <p style="font-size: 15px; margin: 0 0 40px 0; color: #4a4a4a;">Inspirados en el silencio y la simplicidad de lo cotidiano, te enviaremos actualizaciones sobre nuestras colecciones curadas con intención y proyectos especiales.</p>
        `);
      } else if (emailType === "security") {
         finalHtml = wrapHtml(`
           <h2 style="font-size: 24px; font-family: Georgia, serif; font-style: italic; margin-bottom: 20px;">Alerta de Seguridad</h2>
           <p style="font-size: 16px; margin-bottom: 20px; color: #666666;">${customData?.message || "Hemos detectado actividad en tu cuenta."}</p>
           <p style="font-size: 14px; color: #999999;">Dispositivo: ${customData?.device || "Desconocido"}</p>
         `);
      } else if (emailType === "otp") {
         finalHtml = wrapHtml(`
           <h2 style="font-size: 24px; font-family: Georgia, serif; font-style: italic; margin-bottom: 20px;">Tu Código de Verificación</h2>
           <p style="font-size: 16px; margin-bottom: 40px; color: #666666;">Utiliza el siguiente código para seguir (válido por 5 minutos):</p>
           <h1 style="letter-spacing:10px; font-size: 36px; margin: 0;">${customData?.code}</h1>
         `);
      } else if (emailType === "order_confirmation") {
         finalHtml = wrapHtml(`
            <p style="text-align: center; font-size: 12px; text-transform: uppercase; letter-spacing: 3px; color: #8e8e8e; margin: 0 0 40px 0;">Recibo de compra</p>
            <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 10px;">Hola${customData?.name ? ', ' + customData.name : ''}</p>
            <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 20px;">Tu pago mediante <strong>${customData?.method}</strong> se ha procesado con éxito.</p>
            <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 40px;">Envío a: <strong>${customData?.address}</strong></p>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
              ${customData?.itemsHtml || ''}
              ${customData?.discountHtml || ''}
              <tr>
                <td style="padding: 25px 0 10px 0; font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 2px;">Total</td>
                <td style="padding: 25px 0 10px 0; text-align: right; font-family: Georgia, serif; font-style: italic; font-size: 20px;">$${customData?.total?.toFixed(2)}</td>
              </tr>
            </table>
            <p style="font-size: 12px; text-align: center; color: #8e8e8e;">Ref: ${customData?.transactionId}</p>
            <p style="font-size: 13px; line-height: 1.6; color: #8e8e8e; text-align: center; margin-top: 50px; padding-top: 30px; border-top: 1px solid #f0f0f0;">Tu pedido está siendo preparado para ser enviado pronto.<br/>Te notificaremos sobre cualquier avance.</p>
         `);
      } else if (emailType === "support") {
         finalHtml = wrapHtml(`
           <h2 style="font-size: 24px; font-family: Georgia, serif; font-style: italic; margin-bottom: 20px;">Soporte L'Essentiel</h2>
           <p style="font-size: 16px; margin-bottom: 20px; color: #666666;">${customData?.message}</p>
           ${customData?.additionalHtml || ''}
         `);
      }

      console.log(`Sending email (${emailType || 'custom html'}) using ${user}...`);

      const transporter = nodemailer.createTransport({
        host: "mail.spacemail.com",
        port: 465, // SSL
        secure: true, 
        auth: {
          user: user,
          pass: pass,
        },
      });

      const info = await transporter.sendMail({
        from: fromAddress,
        to: to,
        subject: subject,
        text: text,
        html: finalHtml,
      });

      console.log("Message sent: %s", info.messageId);
      res.json({ success: true, messageId: info.messageId });
    } catch (error) {
      console.error("Email error:", error);
      res.status(500).json({ success: false, error: "Failed to send email" });
    }
  });

  // Tilopay API Route Simulation
  app.post("/api/tilopay/create-payment", async (req, res) => {
    try {
      const { amount, orderId, email } = req.body;
      const apiUser = process.env.TILOPAY_API_USER;
      const apiPassword = process.env.TILOPAY_API_PASSWORD;

      if (!apiUser || !apiPassword) {
         // Si no hay llaves de Tilopay, generamos un flujo simulado para que la App funcione visualmente
         return res.json({ 
           success: true, 
           url: null, 
           transactionId: 'TILO-SIM-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
           message: "Simulando cobro con Tilopay (llaves no configuradas)" 
         });
      }

      console.log(`Connecting to Tilopay for Order ${orderId}...`);
      
      // Aquí normalmente se haría el fetch() a la API de Tilopay.
      // Ejemplo:
      // const response = await fetch('https://api.tilopay.com/api/v1/payment/link', { ... })
      // const data = await response.json();
      
      return res.json({ 
          success: true, 
          transactionId: 'TILO-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
          url: null // En un entorno real asíncrono, devolvería URL de redirección
      });

    } catch (error) {
       console.error("Tilopay error:", error);
       res.status(500).json({ success: false, error: "Failed to process card payment" });
    }
  });

  // AI Chat Route
  app.post("/api/ai-chat", aiLimiter, async (req, res) => {
    try {
       const { messages } = req.body;
       const apiKey = process.env.GEMINI_API_KEY?.trim();
       if (!apiKey) return res.status(500).json({ error: "Missing API key" });
       
       const ai = new GoogleGenAI({ apiKey });
       const response = await ai.models.generateContent({
           model: "gemini-3.0-flash-preview",
           contents: messages,
           config: {
             systemInstruction: `Eres un elegante y breve asistente para L'Essentiel, una boutique minimalista de alta moda. 

Base de Conocimiento Operativa:
- Política de Devoluciones: Permitimos devoluciones hasta 14 días después de la entrega si la prenda está limpia, sin uso y con etiquetas originales.
- Tiempos de Envío: El envío estándar nacional tarda de 3 a 5 días hábiles. El envío exprés toma de 1 a 2 días hábiles dependiendo de la zona.
- Política de Privacidad: L'Essentiel cumple rigurosamente con los estándares de encriptación de pagos y no guarda números de tarjetas de crédito.
- Contacto Humano: Si el usuario pide hablar explícitamente con un humano o necesita un reembolso en su tarjeta de crédito (lo cual no puedes hacer automáticamente), responde ESTRICTAMENTE en tu texto con la etiqueta '[ESCALAR]'. 
- Fin de Conversación: Si la duda fue resuelta y se despiden cordialmente, responde ESTRICTAMENTE con la etiqueta '[TERMINAR]'. 

De lo contrario, ayúdales de forma cortés, utilizando respuestas cortas y un tono muy pulido y minimalista.`,
             temperature: 0.7
           }
       });
       res.json({ reply: response.text });
    } catch (error) {
       console.error("AI Error:", error);
       res.status(500).json({ error: "Failed to generate AI response" });
    }
  });

  // Order Tracking Route
  app.post("/api/track-order", aiLimiter, async (req, res) => {
    try {
       const { destinationAddress } = req.body;
       const apiKey = process.env.GEMINI_API_KEY?.trim();
       if (!apiKey) return res.status(500).json({ error: "Missing API key" });
       
       const ai = new GoogleGenAI({ apiKey });
       const response = await ai.models.generateContent({
           model: "gemini-3.0-flash-preview",
           contents: `Genera una experiencia de rastreo de paquete muy detallada. Nuestra tienda está en "Distrito de Lujo, Santiago, Chile". El destino del paquete es "${destinationAddress}". Trázame de forma escrita la ruta precisa estimando por dónde pasaría un camión usando datos reales, cuánto tardaría aproximadamente. Devuelve la respuesta en formato de status de envío elegante. (No pidas más datos, asume la fecha actual de hoy como punto intermedio).`,
           config: {
             tools: [
               { googleMaps: {} } 
             ]
           }
       });
       res.json({ trackingInfo: response.text });
    } catch (error) {
       console.error("AI Tracking Error:", error);
       res.status(500).json({ error: "Failed to generate tracking" });
    }
  });

  // Admin AI Route (Product descriptions, reviews, emails)
  app.post("/api/admin-ai", aiLimiter, async (req, res) => {
    try {
       const { task, data, prompt } = req.body;
       const apiKey = process.env.GEMINI_API_KEY?.trim();
       if (!apiKey) return res.status(500).json({ error: "Missing API key" });
       
       const ai = new GoogleGenAI({ apiKey });
       let aiPrompt = "";
       let systemInstruction = "Eres un experto en e-commerce y marketing para L'Essentiel, una boutique minimalista de alta gama.";

       if (task === 'description') {
           aiPrompt = `Genera una descripción de producto de alta conversión, minimalista y elegante para un producto llamado "${data.name}" de la categoría "${data.category}". Debe destacar exclusividad y lujo sutil. Solo devuelve la descripción en texto plano, sin formato markdown extra, máximo 3 párrafos cortos.`;
       } else if (task === 'email_campaign') {
           aiPrompt = `Genera el código HTML para una campaña de correo basada en esta solicitud: "${prompt}".
           ESTRICTO: El diseño debe ser idéntico al estilo transaccional de L'Essentiel.
           Usa el siguiente contenedor base obligatorio: <div style="padding: 40px; font-family: 'Georgia', serif; color: #1a1a1a; max-width: 600px; margin: auto; border: 1px solid #f0f0f0;">
           Título principal: <h2 style="font-style: italic; font-weight: normal; margin-bottom: 24px;"></h2>
           En subtítulos hazlo sutil; párrafos: <p style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #555555;"></p>
           Botón de CTA (si se requiere): <div style="text-align: center; margin-top: 30px;"><a href="#" style="background-color: #1a1a1a; color: #ffffff; padding: 15px 30px; text-decoration: none; text-transform: uppercase; font-family: 'Helvetica Neue', sans-serif; font-size: 12px; letter-spacing: 2px; display: inline-block;">VER MÁS</a></div>
           Devuelve únicamente el código HTML raw sin meterlo en etiquetas Markdown de \`\`\`html ni nada.`;
       } else if (task === 'analyze_feedback') {
           aiPrompt = `Analiza las siguientes reseñas de clientes y proporciona un resumen ejecutivo conciso (máximo 4 puntos o bullets) sobre qué aman los clientes, qué aspectos mejorar y el sentimiento general del producto:\n\n${data.reviews}`;
       } else {
           return res.status(400).json({ error: "Invalid task" });
       }

       const response = await ai.models.generateContent({
           model: "gemini-3.1-pro-preview",
           contents: aiPrompt,
           config: {
             systemInstruction,
             temperature: 0.7
           }
       });
       
       let text = response.text || "";
       text = text.replace(/^```html\s*/, '').replace(/```\s*$/, '').trim();

       res.json({ result: text });
    } catch (error) {
       console.error("Admin AI Error:", error);
       res.status(500).json({ error: "Failed to generate AI content for admin" });
    }
  });

  // Proxy genérico para peticiones que vienen del cliente (e.g. Búsqueda y Mapas)
  app.post("/api/gemini-proxy", aiLimiter, async (req, res) => {
    try {
        const { params } = req.body;
        const apiKey = process.env.GEMINI_API_KEY?.trim();
        if (!apiKey) return res.status(500).json({ text: "[]" });

        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent(params);
        res.json({ text: response.text });
    } catch (error) {
        console.error("Proxy AI Error:", error);
        res.status(500).json({ text: "[]" });
    }
  });

  // Webhook for Payment Fulfillment (e.g., handling async webhook callbacks from external gateways)
  app.post("/api/webhooks/payment", async (req, res) => {
    try {
       // API logic for processing the incoming payload and validating the HTTP signature
       console.log("🔔 [Webhook] Asynchronous payment confirmation received");
       // Ex: admin.firestore().collection('orders').doc(body.orderId).update({ status: 'pagado' })
       res.status(200).send("Webhook structure initialized.");
    } catch (e) {
       console.error("Webhook Error", e);
       res.status(400).send("Webhook Error");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // For Express 4
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
