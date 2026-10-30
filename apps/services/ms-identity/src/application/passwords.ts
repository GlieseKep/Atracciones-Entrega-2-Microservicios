import bcrypt from 'bcryptjs';

const ROUNDS = 12;
/** Hash de relleno: un correo inexistente tarda lo mismo que una contraseña incorrecta. */
const DUMMY_HASH = bcrypt.hashSync('cuenta-inexistente', ROUNDS);

export const hashPassword = (password: string) => bcrypt.hash(password, ROUNDS);

export const verifyPassword = (password: string, hash: string | null) => bcrypt.compare(password, hash ?? DUMMY_HASH);
