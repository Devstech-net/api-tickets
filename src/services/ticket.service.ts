import mssql from 'mssql';
import SftpClient from 'ssh2-sftp-client';
import 'multer';

import { env } from '../config/env';
import { Ticket, TicketCategory, TicketActivity, TicketStatus } from '../types';
import { poolPromise } from '../config/database';

export const ticketService = {
  getAllCategories: async (): Promise<TicketCategory[]> => {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM tbl_S_qualitor_tickets_categories WHERE is_active = 1');
    return result.recordset;
  },

  resolveEquivalentUserIds: async (userInput: number | string): Promise<number[]> => {
    const pool = await poolPromise;
    const num = Number(userInput);
    const isNum = !isNaN(num) && num > 0;
    const str = String(userInput).trim();

    const req = pool.request();
    req.input('strVal', mssql.NVarChar(50), str);
    let q = 'SELECT id, id_old, personalId FROM FidelissaCRM.dbo.tbl_S_qualitor_user WHERE personalId = @strVal';
    if (isNum) {
      req.input('numVal', mssql.Int, num);
      q += ' OR id = @numVal OR id_old = @numVal';
    }

    const users = (await req.query(q)).recordset;
    const idSet = new Set<number>();
    if (isNum) idSet.add(num);
    for (const u of users) {
      if (u.id) idSet.add(Number(u.id));
      if (u.id_old) idSet.add(Number(u.id_old));
    }
    return Array.from(idSet);
  },

  getTickets: async (status?: string, uid?: string, idUser?: number | string): Promise<Ticket[]> => {
    const pool = await poolPromise;
    let query = `
      SELECT t.*, c.name as categoryName 
      FROM tbl_S_qualitor_tickets_records t
      LEFT JOIN tbl_S_qualitor_tickets_categories c ON c.id = t.idCategory
      WHERE 1=1
    `;
    const request = pool.request();

    if (status) {
      query += ' AND t.status = @status';
      request.input('status', mssql.NVarChar, status);
    }
    if (uid) {
      query += ' AND t.uid LIKE @uid';
      request.input('uid', mssql.NVarChar, `%${uid}%`);
    }
    if (idUser !== undefined && idUser !== null && String(idUser).trim() !== '') {
      const equivalentIds = await ticketService.resolveEquivalentUserIds(idUser);
      if (equivalentIds.length > 0) {
        const paramNames = equivalentIds.map((id, index) => {
          const paramName = `userEquivalentId_${index}`;
          request.input(paramName, mssql.Int, id);
          return `@${paramName}`;
        });
        query += ` AND t.idUser IN (${paramNames.join(', ')})`;
      }
    }

    query += ' ORDER BY t.created_at DESC';
    const result = await request.query(query);
    const tickets = result.recordset as Ticket[];

    if (tickets.length === 0) return [];

    // Fetch attachments for all retrieved tickets
    const ticketIds = tickets.map(t => t.id);
    const attachmentsResult = await pool.request()
      .query(`SELECT * FROM tbl_S_qualitor_tickets_attachments WHERE idTicket IN (${ticketIds.join(',')})`);

    const attachments = attachmentsResult.recordset;

    // Map attachments to tickets
    return tickets.map(ticket => ({
      ...ticket,
      attachments: attachments.filter((a: any) => a.idTicket === ticket.id)
    }));
  },

  getTicketById: async (id: number): Promise<Ticket | null> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', mssql.Int, id)
      .query(`
        SELECT t.*, c.name as categoryName 
        FROM tbl_S_qualitor_tickets_records t
        LEFT JOIN tbl_S_qualitor_tickets_categories c ON c.id = t.idCategory
        WHERE t.id = @id
      `);

    const ticket = result.recordset[0] as Ticket || null;
    if (ticket) {
      ticket.attachments = await ticketService.getAttachmentsByTicketId(ticket.id);
    }
    return ticket;
  },

  getTicketByUid: async (uid: string): Promise<Ticket | null> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('uid', mssql.NVarChar, uid)
      .query(`
        SELECT t.*, c.name as categoryName 
        FROM tbl_S_qualitor_tickets_records t
        LEFT JOIN tbl_S_qualitor_tickets_categories c ON c.id = t.idCategory
        WHERE t.uid = @uid
      `);

    const ticket = result.recordset[0] as Ticket || null;
    if (ticket) {
      ticket.attachments = await ticketService.getAttachmentsByTicketId(ticket.id);
    }
    return ticket;
  },

  createTicket: async (data: any): Promise<Ticket> => {
    const pool = await poolPromise;

    // Verificar si la categoría elegida es "Códigos duplicados"
    const catResult = await pool.request()
      .input('idCategory', mssql.Int, data.idCategory)
      .query('SELECT name FROM tbl_S_qualitor_tickets_categories WHERE id = @idCategory');

    const category = catResult.recordset[0];
    const categoryName = category ? category.name : '';
    const isCodigosDuplicados = categoryName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim() === 'codigos duplicados';

    if (isCodigosDuplicados) {
      if (!data.codigo || !String(data.codigo).trim()) {
        const err: any = new Error('El código es obligatorio para la categoría Códigos duplicados');
        err.statusCode = 400;
        throw err;
      }
    }

    const transaction = new mssql.Transaction(pool);

    try {
      await transaction.begin();

      const title = data.title ? String(data.title).substring(0, 100) : '';
      const description = data.description ? String(data.description).substring(0, 1000) : '';
      const priority = data.priority ? String(data.priority).substring(0, 50) : 'Medium';
      const codigo = (data.codigo && String(data.codigo).trim()) ? String(data.codigo).trim().substring(0, 100) : null;

      const result = await transaction.request()
        .input('idUser', mssql.Int, data.idUser)
        .input('idCategory', mssql.Int, data.idCategory)
        .input('title', mssql.NVarChar(100), title)
        .input('description', mssql.NVarChar(mssql.MAX), description)
        .input('priority', mssql.NVarChar(50), priority)
        .input('codigo', mssql.NVarChar(100), codigo)
        .query(`
          INSERT INTO tbl_S_qualitor_tickets_records (idUser, idCategory, title, description, priority, status, codigo)
          OUTPUT INSERTED.*
          VALUES (@idUser, @idCategory, @title, @description, @priority, 'Open', @codigo)
        `);

      const ticket = result.recordset[0];
      await transaction.commit();
      return ticket;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  addAttachment: async (ticketId: number, file: Express.Multer.File): Promise<{ url: string, name: string }> => {
    const sftp = new SftpClient();
    const fileName = `${Date.now()}-${file.originalname}`;
    const remoteDir = `/uploads/tickets/${ticketId}`;
    const remotePath = `${remoteDir}/${fileName}`;

    try {
      await sftp.connect({
        host: env.HOST_FTP,
        port: 22,
        username: env.USER_FTP,
        password: env.PASS_FTP,
      });

      const dirExists = await sftp.exists(remoteDir);
      if (!dirExists) {
        await sftp.mkdir(remoteDir, true);
      }

      await sftp.put(file.buffer, remotePath);

      const fileUrl = `${env.URL_TICKETS.replace(/\/+$/, '')}${remotePath}`;

      const pool = await poolPromise;
      await pool.request()
        .input('idTicket', mssql.Int, ticketId)
        .input('name', mssql.NVarChar(255), file.originalname)
        .input('type', mssql.NVarChar(50), file.mimetype)
        .input('url', mssql.NVarChar(mssql.MAX), fileUrl)
        .input('size', mssql.NVarChar(50), `${(file.size / 1024).toFixed(2)} KB`)
        .query(`
          INSERT INTO tbl_S_qualitor_tickets_attachments (idTicket, name, type, url, size)
          VALUES (@idTicket, @name, @type, @url, @size)
        `);

      return { url: fileUrl, name: file.originalname };
    } finally {
      await sftp.end();
    }
  },

  updateStatus: async (id: number, status: TicketStatus, author: string, authorRole: TicketActivity['authorRole'] = 'Admin'): Promise<Ticket | null> => {
    const pool = await poolPromise;
    const oldTicket = await ticketService.getTicketById(id);
    if (!oldTicket) return null;

    await pool.request()
      .input('id', mssql.Int, id)
      .input('status', mssql.NVarChar, status)
      .query('UPDATE tbl_S_qualitor_tickets_records SET status = @status, updated_at = GETDATE() WHERE id = @id');

    await ticketService.addActivity({
      idTicket: id,
      type: 'status_change',
      author,
      authorRole,
      content: `Status updated from ${oldTicket.status} to ${status}`,
      statusBadge: status,
    });

    return ticketService.getTicketById(id);
  },

  addActivity: async (data: Omit<TicketActivity, 'id' | 'created_at'>): Promise<TicketActivity> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('idTicket', mssql.Int, data.idTicket)
      .input('type', mssql.NVarChar, data.type)
      .input('author', mssql.NVarChar, data.author)
      .input('authorRole', mssql.NVarChar, data.authorRole)
      .input('content', mssql.NVarChar, data.content)
      .input('statusBadge', mssql.NVarChar, data.statusBadge || null)
      .query(`
        INSERT INTO tbl_S_qualitor_tickets_activities (idTicket, type, author, authorRole, content, statusBadge)
        OUTPUT INSERTED.*
        VALUES (@idTicket, @type, @author, @authorRole, @content, @statusBadge)
      `);

    return result.recordset[0];
  },

  getActivitiesByTicketId: async (ticketId: number): Promise<TicketActivity[]> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ticketId', mssql.Int, ticketId)
      .query('SELECT * FROM tbl_S_qualitor_tickets_activities WHERE idTicket = @ticketId ORDER BY created_at DESC');
    return result.recordset;
  },

  getAttachmentsByTicketId: async (ticketId: number): Promise<any[]> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ticketId', mssql.Int, ticketId)
      .query('SELECT * FROM tbl_S_qualitor_tickets_attachments WHERE idTicket = @ticketId');
    return result.recordset;
  },

  getCodeInfo: async (code: string): Promise<any | null> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('cod', mssql.NVarChar, code)
      .query(`
        SELECT 
          vqc.cod, vqc.point, vqc.register_date, 
          COALESCE(sqc.created_at, vqc.created_at) as fechaCreacionCodigo,
          tsqu.fullname, tsqdt.description as documento, tsqu.personalId as numeroDocumento,
          tsqu.email, tsqu.address as userAddress, tsqu.phone, tsqu.personalId, tsqu.stationId, tsqs.name as stationName, 
          tsqc.nombre as ciudad, tsqdep.name as departamento,
          tsqs.brandId, tsqs.address, tsqb.name as marca
        FROM FidelissaCRM.dbo.vw_qualitor_code AS vqc
        LEFT JOIN FidelissaCRM.dbo.tbl_S_qualitor_code AS sqc on sqc.cod = vqc.cod
        OUTER APPLY (
          SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_user u
          WHERE u.id_old = vqc.user_id_register OR u.id = vqc.user_id_register
          ORDER BY (CASE WHEN u.id_old = vqc.user_id_register THEN 1 ELSE 2 END)
        ) tsqu
        OUTER APPLY (
          SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_station s
          WHERE s.id_old = tsqu.stationId OR s.id = tsqu.stationId
          ORDER BY (CASE WHEN s.id_old = tsqu.stationId THEN 1 ELSE 2 END)
        ) tsqs
        OUTER APPLY (
          SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_city c
          WHERE c.id_old = tsqs.cityId OR c.id = tsqs.cityId
          ORDER BY (CASE WHEN c.id_old = tsqs.cityId THEN 1 ELSE 2 END)
        ) tsqc
        OUTER APPLY (
          SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_state st
          WHERE st.id_old = tsqc.stateId OR st.id = tsqc.stateId
          ORDER BY (CASE WHEN st.id_old = tsqc.stateId THEN 1 ELSE 2 END)
        ) tsqdep
        OUTER APPLY (
          SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_brand b
          WHERE b.id_old = tsqs.brandId OR b.id = tsqs.brandId
          ORDER BY (CASE WHEN b.id_old = tsqs.brandId THEN 1 ELSE 2 END)
        ) tsqb
        OUTER APPLY (
          SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_documentType dt
          WHERE dt.id_old = tsqu.documentTypeId OR dt.id = tsqu.documentTypeId
          ORDER BY (CASE WHEN dt.id_old = tsqu.documentTypeId THEN 1 ELSE 2 END)
        ) tsqdt
        WHERE vqc.cod = @cod
      `);
    return result.recordset[0] || null;
  },

  getUserInfo: async (id: number | string, code?: string): Promise<any | null> => {
    const pool = await poolPromise;
    const request = pool.request();
    const num = Number(id);
    const isNum = !isNaN(num) && num > 0;
    const str = String(id).trim();

    request.input('str', mssql.NVarChar(50), str);
    if (isNum) {
      request.input('id', mssql.Int, num);
    }

    let codeJoin = '';
    let codeSelect = 'NULL as fechaCreacionCodigo';
    if (code) {
      request.input('code', mssql.NVarChar, code);
      codeJoin = 'LEFT JOIN FidelissaCRM.dbo.tbl_S_qualitor_code AS sqc on sqc.cod = @code';
      codeSelect = 'sqc.created_at as fechaCreacionCodigo';
    }

    const userCond = isNum 
      ? '(usr.id_old = @id OR usr.id = @id OR usr.personalId = @str)'
      : 'usr.personalId = @str';

    // Priorización inteligente:
    // Si num es 22289 o 23447, sabemos que son IDs primarios registrados por esos usuarios
    const orderCond = isNum
      ? `(CASE 
            WHEN usr.personalId = @str THEN 1 
            WHEN usr.id = @id AND @id IN (22289, 23447) THEN 2
            WHEN usr.id_old = @id THEN 3 
            WHEN usr.id = @id THEN 4 
            ELSE 5 
          END)`
      : '1';

    const result = await request.query(`
      SELECT TOP 1 
        usr.id, usr.id_old, usr.fullname, tsqdt.description as documento, 
        usr.personalId as numeroDocumento, usr.personalId,
        tsqc.nombre as ciudad, tsqdep.name as departamento, 
        tsqs.name as stationName, tsqb.name as marca,
        tsqs.address, ${codeSelect}
      FROM FidelissaCRM.dbo.tbl_S_qualitor_user usr
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_station s
        WHERE s.id_old = usr.stationId OR s.id = usr.stationId
        ORDER BY (CASE WHEN s.id_old = usr.stationId THEN 1 ELSE 2 END)
      ) tsqs
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_city c
        WHERE c.id_old = tsqs.cityId OR c.id = tsqs.cityId
        ORDER BY (CASE WHEN c.id_old = tsqs.cityId THEN 1 ELSE 2 END)
      ) tsqc
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_state st
        WHERE st.id_old = tsqc.stateId OR st.id = tsqc.stateId
        ORDER BY (CASE WHEN st.id_old = tsqc.stateId THEN 1 ELSE 2 END)
      ) tsqdep
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_brand b
        WHERE b.id_old = tsqs.brandId OR b.id = tsqs.brandId
        ORDER BY (CASE WHEN b.id_old = tsqs.brandId THEN 1 ELSE 2 END)
      ) tsqb
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_documentType dt
        WHERE dt.id_old = usr.documentTypeId OR dt.id = usr.documentTypeId
        ORDER BY (CASE WHEN dt.id_old = usr.documentTypeId THEN 1 ELSE 2 END)
      ) tsqdt
      ${codeJoin}
      WHERE ${userCond}
      ORDER BY ${orderCond}
    `);
    return result.recordset[0] || null;
  },

  getTicketsExportData: async (filters?: {
    status?: string;
    idCategory?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> => {
    const pool = await poolPromise;
    const request = pool.request();

    let whereClause = 'WHERE 1=1';

    if (filters?.status) {
      whereClause += ' AND t.status = @status';
      request.input('status', mssql.NVarChar(50), filters.status);
    }
    if (filters?.idCategory) {
      whereClause += ' AND t.idCategory = @idCategory';
      request.input('idCategory', mssql.Int, filters.idCategory);
    }
    if (filters?.startDate) {
      whereClause += ' AND t.created_at >= @startDate';
      request.input('startDate', mssql.DateTime, new Date(filters.startDate));
    }
    if (filters?.endDate) {
      whereClause += ' AND t.created_at <= @endDate';
      request.input('endDate', mssql.DateTime, new Date(filters.endDate));
    }

    const query = `
      SELECT 
        t.id,
        c.name as categoria,
        t.description as descripcion,
        t.id as n_pqrs,
        t.created_at as fecha_creacion,
        t.status as estado,
        act.author as usuario_gestiona,
        
        -- Datos de quien reporta (creador del ticket)
        rep_u.personalId as doc_reporta,
        rep_u.fullname as user_reporta,
        rep_city.nombre as ciudad_reporta,
        rep_state.name as depto_reporta,
        rep_brand.name as marca_eds_reporta,
        rep_station.name as nombre_eds_reporta,
        rep_station.address as direccion_eds_reporta,
        
        -- Datos del código
        COALESCE(sqc.created_at, vqc.created_at) as fecha_creacion_codigo,
        t.codigo as codigo,
        vqc.point as valor_codigo,
        vqc.register_date as fecha_registro_codigo,
        
        -- Datos de quien registró el código
        reg_u.fullname as user_registro,
        reg_u.personalId as doc_registro,
        reg_city.nombre as ciudad_registro,
        reg_state.name as depto_registro,
        reg_brand.name as marca_eds_registro,
        reg_station.name as nombre_eds_registro,
        reg_station.address as direccion_eds_registro
        
      FROM tbl_S_qualitor_tickets_records t
      LEFT JOIN tbl_S_qualitor_tickets_categories c ON c.id = t.idCategory
      
      OUTER APPLY (
        SELECT TOP 1 author 
        FROM tbl_S_qualitor_tickets_activities a 
        WHERE a.idTicket = t.id AND a.authorRole IN ('Admin', 'System')
        ORDER BY a.created_at DESC
      ) act
      
      OUTER APPLY (
        SELECT TOP 1 *
        FROM FidelissaCRM.dbo.tbl_S_qualitor_user u
        WHERE u.id = t.idUser OR u.id_old = t.idUser
        ORDER BY (CASE WHEN u.id = t.idUser THEN 1 ELSE 2 END)
      ) rep_u
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_station s
        WHERE s.id_old = rep_u.stationId OR s.id = rep_u.stationId
        ORDER BY (CASE WHEN s.id_old = rep_u.stationId THEN 1 ELSE 2 END)
      ) rep_station
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_city ci
        WHERE ci.id_old = rep_station.cityId OR ci.id = rep_station.cityId
        ORDER BY (CASE WHEN ci.id_old = rep_station.cityId THEN 1 ELSE 2 END)
      ) rep_city
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_state st
        WHERE st.id_old = rep_city.stateId OR st.id = rep_city.stateId
        ORDER BY (CASE WHEN st.id_old = rep_city.stateId THEN 1 ELSE 2 END)
      ) rep_state
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_brand b
        WHERE b.id_old = rep_station.brandId OR b.id = rep_station.brandId
        ORDER BY (CASE WHEN b.id_old = rep_station.brandId THEN 1 ELSE 2 END)
      ) rep_brand
      
      OUTER APPLY (
        SELECT TOP 1 q.created_at
        FROM FidelissaCRM.dbo.tbl_S_qualitor_code q
        WHERE q.cod = t.codigo
      ) sqc
      
      OUTER APPLY (
        SELECT TOP 1 v.point, v.created_at, v.register_date, v.user_id_register
        FROM FidelissaCRM.dbo.vw_qualitor_code v
        WHERE v.cod = t.codigo
      ) vqc
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_user u
        WHERE u.id_old = vqc.user_id_register OR u.id = vqc.user_id_register
        ORDER BY (CASE WHEN u.id_old = vqc.user_id_register THEN 1 ELSE 2 END)
      ) reg_u
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_station s
        WHERE s.id_old = reg_u.stationId OR s.id = reg_u.stationId
        ORDER BY (CASE WHEN s.id_old = reg_u.stationId THEN 1 ELSE 2 END)
      ) reg_station
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_city ci
        WHERE ci.id_old = reg_station.cityId OR ci.id = reg_station.cityId
        ORDER BY (CASE WHEN ci.id_old = reg_station.cityId THEN 1 ELSE 2 END)
      ) reg_city
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_state st
        WHERE st.id_old = reg_city.stateId OR st.id = reg_city.stateId
        ORDER BY (CASE WHEN st.id_old = reg_city.stateId THEN 1 ELSE 2 END)
      ) reg_state
      
      OUTER APPLY (
        SELECT TOP 1 * FROM FidelissaCRM.dbo.tbl_S_qualitor_brand b
        WHERE b.id_old = reg_station.brandId OR b.id = reg_station.brandId
        ORDER BY (CASE WHEN b.id_old = reg_station.brandId THEN 1 ELSE 2 END)
      ) reg_brand
      
      ${whereClause}
      ORDER BY t.id DESC
    `;

    const result = await request.query(query);
    return result.recordset;
  }
};


