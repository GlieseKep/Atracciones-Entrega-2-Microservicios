-- Bases de datos del sistema (se ejecuta solo al crear el volumen). Las tablas las crea `npm run db:migrate`.
-- `tourgirls` es la base del monolito mientras siga en uso (plan §7.7, prefijo provisional /internal/web).
CREATE DATABASE tourgirls ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE identity_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_identity ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE catalog_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_catalog ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE inventory_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_inventory ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE cart_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_cart ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_coupon ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_pricing ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_location ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_billing_profile ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_review ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_refund ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_support ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE order_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_order ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE booking_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_booking ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE payment_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE ms_payment ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE invoicing_db ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE audit_db ENCODING 'UTF8' TEMPLATE template0;
