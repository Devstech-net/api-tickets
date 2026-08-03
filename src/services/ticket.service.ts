import mssql from 'mssql';
import SftpClient from 'ssh2-sftp-client';

import { env } from '../config/env';
import { Ticket, TicketCategory, TicketActivity, TicketStatus } from '../types';
import { poolPromise } from '../config/database';

export const ticketService = {
  getAllCategories: async (): Promise<TicketCategory[]> => {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM tbl_S_qualitor_tickets_categories WHERE is_active = 1');
    return result.recordset;
  },

  getTickets: async (status?: string, uid?: string): Promise<Ticket[]> => {
    const pool = await poolPromise;
    let query = 'SELECT * FROM tbl_S_qualitor_tickets_records WHERE 1=1';
    const request = pool.request();

    if (status) {
      query += ' AND status = @status';
      request.input('status', mssql.NVarChar, status);
    }
    if (uid) {
      query += ' AND uid LIKE @uid';
      request.input('uid', mssql.NVarChar, `%${uid}%`);
    }

    query += ' ORDER BY created_at DESC';
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
      .query('SELECT * FROM tbl_S_qualitor_tickets_records WHERE id = @id');

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
      .query('SELECT * FROM tbl_S_qualitor_tickets_records WHERE uid = @uid');

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
        username: env.USER_FTP,
        password: env.PASS_FTP,
      });

      // Asegurar que el directorio existe
      await sftp.mkdir(remoteDir, true);

      // Subir el archivo
      await sftp.put(file.buffer, remotePath);

      // Construir la URL pública (asumiendo que env.URL_TICKETS es la base)
      const url = `${env.URL_TICKETS}${ticketId}/${fileName}`;

      const nameTruncated = file.originalname ? String(file.originalname).substring(0, 255) : 'file';
      const typeTruncated = file.mimetype ? String(file.mimetype).substring(0, 50) : 'image/jpeg';
      const urlTruncated = url ? String(url).substring(0, 500) : '';
      const sizeTruncated = file.size ? String(file.size).substring(0, 50) : '0';

      const pool = await poolPromise;
      await pool.request()
        .input('idTicket', mssql.Int, ticketId)
        .input('name', mssql.NVarChar(255), nameTruncated)
        .input('type', mssql.NVarChar(50), typeTruncated)
        .input('url', mssql.NVarChar(500), urlTruncated)
        .input('size', mssql.NVarChar(50), sizeTruncated)
        .query(`
          INSERT INTO tbl_S_qualitor_tickets_attachments (idTicket, name, type, url, size)
          VALUES (@idTicket, @name, @type, @url, @size)
        `);

      return { url, name: file.originalname };
    } catch (error: any) {
      console.error('Error uploading to SFTP:', error);
      throw new Error(`Error al subir archivo al servidor SFTP: ${error.message}`);
    } finally {
      await sftp.end();
    }
  },

  updateStatus: async (id: number, status: string, author: string, authorRole: string): Promise<Ticket | null> => {
    const pool = await poolPromise;
    const transaction = new mssql.Transaction(pool);
    try {
      await transaction.begin();

      const updateResult = await transaction.request()
        .input('id', mssql.Int, id)
        .input('status', mssql.NVarChar(50), status ? String(status).substring(0, 50) : 'Open')
        .query('UPDATE tbl_S_qualitor_tickets_records SET status = @status, updated_at = GETDATE() OUTPUT INSERTED.* WHERE id = @id');

      const ticket = updateResult.recordset[0];
      if (ticket) {
        await transaction.request()
          .input('idTicket', mssql.Int, id)
          .input('type', mssql.NVarChar(50), 'status_change')
          .input('author', mssql.NVarChar(150), author ? String(author).substring(0, 150) : 'System')
          .input('authorRole', mssql.NVarChar(50), authorRole ? String(authorRole).substring(0, 50) : 'Admin')
          .input('content', mssql.NVarChar(mssql.MAX), `Estado cambiado a ${status}`)
          .input('statusBadge', mssql.NVarChar(50), status ? String(status).substring(0, 50) : null)
          .query('INSERT INTO tbl_S_qualitor_tickets_activities (idTicket, type, author, authorRole, content, statusBadge) VALUES (@idTicket, @type, @author, @authorRole, @content, @statusBadge)');
      }

      await transaction.commit();
      return ticket;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  addActivity: async (data: any): Promise<TicketActivity> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('idTicket', mssql.Int, data.idTicket)
      .input('type', mssql.NVarChar(50), data.type ? String(data.type).substring(0, 50) : 'message')
      .input('author', mssql.NVarChar(150), data.author ? String(data.author).substring(0, 150) : 'User')
      .input('authorRole', mssql.NVarChar(50), data.authorRole ? String(data.authorRole).substring(0, 50) : 'User')
      .input('content', mssql.NVarChar(mssql.MAX), data.content ? String(data.content) : '')
      .input('statusBadge', mssql.NVarChar(50), data.statusBadge ? String(data.statusBadge).substring(0, 50) : null)
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
        SELECT vqc.cod, vqc.point, vqc.register_date, tsqu.fullname, tsqdt.description as documento,
        tsqu.email,tsqu.address, tsqu.phone, tsqu.personalId, tsqu.stationId, tsqs.name as stationName, 
        tsqs.brandId, tsqs.address, tsqb.name as marca
        FROM FidelissaCRM.dbo.vw_qualitor_code AS vqc
        left join FidelissaCRM.dbo.tbl_S_qualitor_user AS tsqu on tsqu.id = vqc.user_id_register
        left join FidelissaCRM.dbo.tbl_S_qualitor_documentType AS tsqdt on tsqdt.id = tsqu.documentTypeId 
        left join FidelissaCRM.dbo.tbl_S_qualitor_station AS tsqs on tsqs.id = tsqu.stationId 
        left join FidelissaCRM.dbo.tbl_S_qualitor_team AS tsqt on tsqt.userId = vqc.user_id_register 
        left join FidelissaCRM.dbo.tbl_S_qualitor_brand AS tsqb on tsqb.id = tsqs.brandId  
        WHERE cod = @cod
      `);
    return result.recordset[0] || null;
  },

  getUserInfo: async (id: number): Promise<any | null> => {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', mssql.Int, id)
      .query(`
        select usr.fullname, tsqdt.description as documento, tsqb.name as marca,
        tsqs.address
        from FidelissaCRM.dbo.tbl_S_qualitor_user usr
        left join FidelissaCRM.dbo.tbl_S_qualitor_documentType AS tsqdt on tsqdt.id = usr.documentTypeId 
        left join FidelissaCRM.dbo.tbl_S_qualitor_station AS tsqs on tsqs.id = usr.stationId  
        left join FidelissaCRM.dbo.tbl_S_qualitor_brand AS tsqb on tsqb.id = tsqs.brandId 
        where usr.id_old = @id
      `);
    return result.recordset[0] || null;
  }
};

