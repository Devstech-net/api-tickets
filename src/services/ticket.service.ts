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
    const transaction = new mssql.Transaction(pool);

    try {
      await transaction.begin();

      const result = await transaction.request()
        .input('idUser', mssql.Int, data.idUser)
        .input('idCategory', mssql.Int, data.idCategory)
        .input('title', mssql.NVarChar, data.title)
        .input('description', mssql.NVarChar, data.description)
        .input('priority', mssql.NVarChar, data.priority || 'Medium')
        .input('codigo', mssql.NVarChar, data.codigo || null)
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

      const pool = await poolPromise;
      await pool.request()
        .input('idTicket', mssql.Int, ticketId)
        .input('name', mssql.NVarChar, file.originalname)
        .input('type', mssql.NVarChar, file.mimetype)
        .input('url', mssql.NVarChar, url)
        .input('size', mssql.NVarChar, file.size.toString())
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
        .input('status', mssql.NVarChar, status)
        .query('UPDATE tbl_S_qualitor_tickets_records SET status = @status, updated_at = GETDATE() OUTPUT INSERTED.* WHERE id = @id');

      const ticket = updateResult.recordset[0];
      if (ticket) {
        await transaction.request()
          .input('idTicket', mssql.Int, id)
          .input('type', mssql.NVarChar, 'status_change')
          .input('author', mssql.NVarChar, author)
          .input('authorRole', mssql.NVarChar, authorRole)
          .input('content', mssql.NVarChar, `Estado cambiado a ${status}`)
          .input('statusBadge', mssql.NVarChar, status)
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
      .input('type', mssql.NVarChar, data.type || 'message')
      .input('author', mssql.NVarChar, data.author)
      .input('authorRole', mssql.NVarChar, data.authorRole)
      .input('content', mssql.NVarChar, data.content)
      .input('statusBadge', mssql.NVarChar, data.statusBadge)
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
        tsqu.email, tsqu.address as userAddress, tsqu.phone, tsqu.personalId, tsqu.stationId, tsqs.name as stationName, 
        tsqst.brandId, tsqst.address, tsqb.name as marca
        FROM FidelissaCRM.dbo.vw_qualitor_code AS vqc
        left join FidelissaCRM.dbo.tbl_S_qualitor_user AS tsqu on tsqu.id = vqc.user_id_register
        left join FidelissaCRM.dbo.tbl_S_qualitor_documentType AS tsqdt on tsqdt.id = tsqu.documentTypeId 
        left join FidelissaCRM.dbo.tbl_S_qualitor_station AS tsqs on tsqs.id = tsqu.stationId 
        left join FidelissaCRM.dbo.tbl_S_qualitor_team AS tsqt on tsqt.userId = vqc.user_id_register 
        left join FidelissaCRM.dbo.tbl_S_qualitor_station AS tsqst on tsqst.id  = tsqu.stationId
        left join FidelissaCRM.dbo.tbl_S_qualitor_brand AS tsqb on tsqb.id = tsqst.brandId 
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
        where usr.id = @id
      `);
    return result.recordset[0] || null;
  }
};

