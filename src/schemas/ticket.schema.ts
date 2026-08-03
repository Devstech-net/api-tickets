import { z } from 'zod';

export const ticketStatusEnum = z.enum(['Open', 'In Progress', 'Resolved', 'Closed']);
export const ticketPriorityEnum = z.enum(['Low', 'Medium', 'High']);

export const createTicketSchema = z.object({
  idUser: z.coerce.number().positive(),
  idCategory: z.coerce.number().positive(),
  title: z.string().min(3, 'El título debe tener al menos 3 caracteres').max(100),
  description: z.string().min(5, 'La descripción debe tener al menos 5 caracteres').max(1000),
  priority: ticketPriorityEnum.default('Medium'),
  evidence: z.union([z.string(), z.any()]).optional(), // Can be base64 string or file object
  codigo: z.string().optional().nullable().or(z.literal(''))
});

export const updateTicketStatusSchema = z.object({
  status: ticketStatusEnum,
  author: z.string().min(1),
  authorRole: z.enum(['User', 'Admin', 'System']).default('Admin'),
});

export const createActivitySchema = z.object({
  type: z.enum(['message', 'status_change', 'creation']).default('message'),
  author: z.string().min(1, 'El autor es requerido').max(150),
  authorRole: z.enum(['User', 'Admin', 'System']).default('User'),
  content: z.string().min(1, 'El contenido es requerido'),
  statusBadge: z.string().optional(),
});

export const queryTicketsSchema = z.object({
  status: ticketStatusEnum.optional(),
  uid: z.string().optional(),
});

export const getCodeInfoSchema = z.object({
  code: z.string().min(1, 'El código es requerido')
});

export const getUserInfoSchema = z.object({
  id: z.coerce.number().positive('El ID de usuario debe ser un número positivo')
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type QueryTicketsInput = z.infer<typeof queryTicketsSchema>;
export type GetCodeInfoInput = z.infer<typeof getCodeInfoSchema>;
export type GetUserInfoInput = z.infer<typeof getUserInfoSchema>;

