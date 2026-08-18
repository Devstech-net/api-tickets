export type TicketStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed';
export type TicketPriority = 'Low' | 'Medium' | 'High';

export interface TicketCategory {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Ticket {
  id: number;
  uid: string; // Used for public searching/filtering
  idUser: number;
  idCategory: number;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  updated_at?: string;
  attachments?: TicketAttachment[];
}

export interface TicketAttachment {
  id: number;
  idTicket: number;
  name: string;
  type: string;
  url: string;
  size?: string;
  created_at: string;
}

export interface TicketActivity {
  id: number;
  idTicket: number;
  type: 'message' | 'status_change' | 'creation';
  author: string;
  authorRole: 'User' | 'Admin' | 'System';
  content: string;
  statusBadge?: string;
  created_at: string;
}

export interface TicketExportRow {
  id: number;
  categoria: string | null;
  descripcion: string | null;
  n_pqrs: number | string | null;
  fecha_creacion: string | Date | null;
  estado: string | null;
  usuario_gestiona: string | null;
  doc_reporta: string | null;
  user_reporta: string | null;
  ciudad_reporta: string | null;
  depto_reporta: string | null;
  marca_eds_reporta: string | null;
  nombre_eds_reporta: string | null;
  direccion_eds_reporta: string | null;
  fecha_creacion_codigo: string | Date | null;
  codigo: string | null;
  valor_codigo: number | null;
  fecha_registro_codigo: string | Date | null;
  user_registro: string | null;
  doc_registro: string | null;
  ciudad_registro: string | null;
  depto_registro: string | null;
  marca_eds_registro: string | null;
  nombre_eds_registro: string | null;
  direccion_eds_registro: string | null;
}

export interface TicketStore {
  tickets: Ticket[];
  activities: TicketActivity[];
  categories: TicketCategory[];
  addTicket: (ticket: Ticket) => void;
  getTickets: (status?: TicketStatus, uid?: string) => Ticket[];
  getTicketById: (id: number) => Ticket | undefined;
  getTicketByUid: (uid: string) => Ticket | undefined;
  updateTicketStatus: (id: number, status: TicketStatus, author: string, authorRole: TicketActivity['authorRole']) => Ticket | undefined;
  addActivity: (activity: TicketActivity) => void;
  getActivitiesByTicketId: (ticketId: number) => TicketActivity[];
}

