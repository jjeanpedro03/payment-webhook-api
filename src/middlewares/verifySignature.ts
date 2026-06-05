import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface AuthenticatedRequest extends Request {
  rawBody?: string;
}

export function verifyWebhookSignature(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // 1. Verifica se a assinatura foi fornecida
  const signature = req.headers['x-webhook-signature'] as string;
  const secret = process.env.WEBHOOK_SECRET;

  if (!signature) {
    res.status(401).json({ error: 'Assinatura não fornecida (X-Webhook-Signature ausente)' });
    return;
  }

  if (!secret) {
    res.status(500).json({ error: 'Chave secreta não configurada no servidor' });
    return;
  }

  if (!req.rawBody) {
    res.status(400).json({ error: 'Corpo da requisição vazio ou inválido' });
    return;
  }

  // 2. Calcula a assinatura esperada
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  // 3. Compara a assinatura fornecida com a esperada
  const isSignatureValid = crypto.timingSafeEqual(
    Buffer.from(signature, 'utf-8'),
    Buffer.from(expectedSignature, 'utf-8')
  );

  if (!isSignatureValid) {
    res.status(403).json({ error: 'Assinatura inválida. Requisição rejeitada!' });
    return;
  }

  // 4. Se a assinatura for válida, continua a requisição
  next();
}