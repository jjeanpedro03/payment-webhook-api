import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { pool } from './config/database.js';
import { verifyWebhookSignature } from './middlewares/verifySignature.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

interface CustomRequest extends express.Request {
  rawBody?: string;
}

app.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(express.static('public'));

app.get('/status', (req, res) => {
  res.json({ status: 'operacional', timestamp: new Date() });
});

// ROTA PRINCIPAL ATUALIZADA COM REGRAS DE NEGÓCIO
app.post('/webhook/v1/payments', verifyWebhookSignature, async (req: CustomRequest, res) => {
  const { id_evento, tipo, payload, status } = req.body;

  if (!id_evento || !tipo || !payload || !status) {
    res.status(400).json({ error: 'Campos obrigatórios ausentes no payload' });
    return;
  }

  try {
    // 1. IDEMPOTÊNCIA (Continua igual, protegendo o banco)
    const checkEvent = await pool.query(
      'SELECT id FROM webhook_events WHERE id_evento = $1',
      [id_evento]
    );

    if (checkEvent.rows.length > 0) {
      console.log(`⚠️ Evento duplicado ignorado: ${id_evento}`);
      res.status(200).json({ message: 'Evento já processado anteriormente (Idempotente)' });
      return;
    }

    // 2. SALVAR NO NEON (Registra o histórico bruto)
    const queryText = `
      INSERT INTO webhook_events (id_evento, tipo, payload, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const queryValues = [id_evento, tipo, JSON.stringify(payload), status];
    const result = await pool.query(queryText, queryValues);

    // 3. 🔀 REGRAS DE NEGÓCIO ESPECÍFICAS PARA CADA STATUS
    let acaoInterna = '';
    const nomeCliente = payload.cliente?.nome || 'Cliente';

    switch (status) {
      case 'success':
        acaoInterna = `🟢 [SUCESSO] Pagamento aprovado! Liberando o produto para ${nomeCliente} no sistema e enviando e-mail de boas-vindas.`;
        break;
      
      case 'failed':
        acaoInterna = `🔴 [RECUSADO] O pagamento de ${nomeCliente} falhou ou foi recusado. Notificando nossa equipe de vendas para suporte.`;
        break;
      
      case 'refunded':
        acaoInterna = `🔵 [ESTORNO] O pagamento de ${nomeCliente} foi devolvido. Bloqueando o acesso ao produto imediatamente.`;
        break;
      
      default:
        acaoInterna = `🟡 [DESCONHECIDO] Evento recebido, mas nenhum comportamento padrão foi mapeado para o status: ${status}.`;
    }

    // Mostra no terminal o que o seu sistema faria na prática
    console.log(acaoInterna);

    // 4. Retorna a resposta customizada para a tela ver o resultado da regra de negócio
    res.status(201).json({
      success: true,
      message: 'Webhook processado com sucesso!',
      log_banco_id: result.rows[0].id,
      regra_executada: acaoInterna
    });

  } catch (error: any) {
    console.error('❌ Erro ao processar webhook no banco:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar o evento' });
  }
});

app.post('/debug/generate-signature', (req: CustomRequest, res) => {
  const secret = process.env.WEBHOOK_SECRET || '';
  const bodyString = req.rawBody || JSON.stringify(req.body);
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(bodyString)
    .digest('hex');
    
  res.json({ signature });
});

app.listen(PORT, () => {
  console.log(`📡 Servidor rodando com sucesso na porta ${PORT}`);
});