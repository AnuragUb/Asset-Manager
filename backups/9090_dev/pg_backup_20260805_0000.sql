--
-- PostgreSQL database dump
--

\restrict vJo1a1CpX5uagwNTCarfAdrD3c2p0isnjh7qUTWcg7ceO1Dk2ziz9ClDcfLs0JP

-- Dumped from database version 15.18
-- Dumped by pg_dump version 15.18 (Debian 15.18-0+deb12u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: check_cross_table_id_duplication(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_cross_table_id_duplication() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        -- If we are inserting into assets, check components
        IF (TG_TABLE_NAME = 'assets') THEN
            IF EXISTS (SELECT 1 FROM components WHERE LOWER(id) = LOWER(NEW.id)) THEN
                RAISE EXCEPTION 'ID % already exists in components table. Cannot create duplicate in assets.', NEW.id;
            END IF;
        -- If we are inserting into components, check assets
        ELSIF (TG_TABLE_NAME = 'components') THEN
            IF EXISTS (SELECT 1 FROM assets WHERE LOWER(id) = LOWER(NEW.id)) THEN
                RAISE EXCEPTION 'ID % already exists in assets table. Cannot create duplicate in components.', NEW.id;
            END IF;
        END IF;
        RETURN NEW;
    END;
    $$;


ALTER FUNCTION public.check_cross_table_id_duplication() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: arri_clients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arri_clients (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    address text,
    contactperson character varying(255),
    contactno character varying(255),
    email character varying(255),
    created_at character varying(255) DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.arri_clients OWNER TO postgres;

--
-- Name: arri_clients_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.arri_clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.arri_clients_id_seq OWNER TO postgres;

--
-- Name: arri_clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.arri_clients_id_seq OWNED BY public.arri_clients.id;


--
-- Name: arri_job_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arri_job_cards (
    jobcardno character varying(255) NOT NULL,
    date character varying(255) NOT NULL,
    customername character varying(255) NOT NULL,
    customeraddress text,
    contactperson character varying(255),
    contactno character varying(255),
    brandmake character varying(255),
    modelname character varying(255),
    serialno character varying(255),
    receivingengineer character varying(255),
    acc1 character varying(255),
    acc2 character varying(255),
    acc3 character varying(255),
    acc4 character varying(255),
    typeamc boolean DEFAULT false,
    typewarranty boolean DEFAULT false,
    typenowarranty boolean DEFAULT false,
    typeother boolean DEFAULT false,
    reportedproblem text,
    actiontaken text,
    faultfound text,
    faultsn character varying(255),
    partsreplaced text,
    partssn character varying(255),
    conclusion text,
    invoiceto character varying(255),
    invoiceno character varying(255),
    invoicedate character varying(255),
    estimatedvalue real DEFAULT '0'::real,
    created_at character varying(255) DEFAULT CURRENT_TIMESTAMP,
    status character varying(255) DEFAULT 'Pending'::character varying
);


ALTER TABLE public.arri_job_cards OWNER TO postgres;

--
-- Name: asset_hierarchy; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_hierarchy (
    id character varying(255) NOT NULL,
    parentid character varying(255),
    assetid character varying(255),
    "position" integer
);


ALTER TABLE public.asset_hierarchy OWNER TO postgres;

--
-- Name: asset_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_history (
    id integer NOT NULL,
    assetid character varying(255) NOT NULL,
    action character varying(255) NOT NULL,
    oldvalue text,
    newvalue text,
    "user" character varying(255),
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    details text
);


ALTER TABLE public.asset_history OWNER TO postgres;

--
-- Name: asset_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.asset_history_id_seq OWNER TO postgres;

--
-- Name: asset_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_history_id_seq OWNED BY public.asset_history.id;


--
-- Name: asset_it_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_it_details (
    assetid character varying(255) NOT NULL,
    macaddress character varying(255),
    ipaddress character varying(255),
    networktype character varying(255),
    physicalport character varying(255),
    vlan character varying(255),
    socketid character varying(255),
    userid character varying(255)
);


ALTER TABLE public.asset_it_details OWNER TO postgres;

--
-- Name: asset_kinds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_kinds (
    name character varying(255) NOT NULL,
    module character varying(255),
    icon character varying(255),
    parentname character varying(255),
    lastupdated character varying(255),
    displayimage character varying(255),
    identifier character varying(255),
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255)
);


ALTER TABLE public.asset_kinds OWNER TO postgres;

--
-- Name: assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assets (
    id character varying(255) NOT NULL,
    no character varying(255),
    itemname text NOT NULL,
    itemdescription text,
    status character varying(255),
    make character varying(255),
    model character varying(255),
    srno character varying(255),
    serialno character varying(255),
    type character varying(255),
    category character varying(255),
    icon text,
    isplaceholder integer DEFAULT 0,
    parentid character varying(255),
    currentlocation text,
    previouslocation text,
    dispatchreceivedt character varying(255),
    purchasedetails text,
    remarks text,
    purpose text,
    purchasedate character varying(255),
    lastupdated character varying(255),
    qrcode text,
    assignedto text,
    macaddress character varying(255),
    ipaddress character varying(255),
    networktype character varying(255),
    physicalport character varying(255),
    vlan character varying(255),
    socketid character varying(255),
    userid character varying(255),
    noqr integer DEFAULT 0,
    currency character varying(255) DEFAULT 'INR'::character varying,
    asset_value real DEFAULT '0'::real,
    warranty_months integer DEFAULT 0,
    amc_months integer DEFAULT 0,
    quantity_parent_id character varying(255),
    quantity_root_id character varying(255),
    quantity_unit character varying(255),
    quantity_total real,
    quantity_available real,
    quantity_precision integer,
    quantity_updated_at character varying(255),
    conversion_unit character varying(255),
    conversion_factor real,
    conversion_mode character varying(255),
    is_quantity_tracked integer DEFAULT 0,
    warranty_tracking integer DEFAULT 0,
    boughtagainstpo text,
    sentagainstdc text,
    is_batch integer DEFAULT 0,
    linked_po_item_id integer,
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255),
    department character varying(255),
    company_id character varying(255),
    is_set integer DEFAULT 0,
    set_price_mode character varying(255) DEFAULT 'SUM_OF_CHILDREN'::character varying,
    weight character varying(255),
    client_label text,
    parent_folder text,
    zoho_product_id character varying(255),
    hsn_code character varying(255),
    is_retired integer DEFAULT 0,
    condition character varying(255) DEFAULT 'Good'::character varying
);


ALTER TABLE public.assets OWNER TO postgres;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    action character varying(255) NOT NULL,
    "user" character varying(255),
    assetid character varying(255),
    severity character varying(255),
    details text,
    "timestamp" character varying(255)
);


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.audit_log_id_seq OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: auth_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_tokens (
    user_id character varying(255) NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.auth_tokens OWNER TO postgres;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.companies (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    created_at character varying(255)
);


ALTER TABLE public.companies OWNER TO postgres;

--
-- Name: company_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.company_templates (
    id integer NOT NULL,
    company_id character varying(255),
    template_type character varying(255),
    template_data text,
    created_at character varying(255),
    name character varying(255),
    company_name character varying(255),
    address text,
    gst character varying(255),
    cin character varying(255),
    state_name character varying(255),
    state_code character varying(255),
    is_default integer DEFAULT 0
);


ALTER TABLE public.company_templates OWNER TO postgres;

--
-- Name: company_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.company_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.company_templates_id_seq OWNER TO postgres;

--
-- Name: company_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.company_templates_id_seq OWNED BY public.company_templates.id;


--
-- Name: components; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.components (
    id character varying(255) NOT NULL,
    parentid character varying(255),
    type character varying(255),
    name character varying(255),
    description text,
    weight character varying(255),
    itemname text,
    make character varying(255),
    model character varying(255),
    srno character varying(255),
    status character varying(255),
    category character varying(255),
    lastupdated character varying(255),
    noqr integer DEFAULT 0
);


ALTER TABLE public.components OWNER TO postgres;

--
-- Name: dc_item_mappings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dc_item_mappings (
    id integer NOT NULL,
    dc_id character varying(255) NOT NULL,
    assetid character varying(255) NOT NULL,
    customname text,
    customdescription text,
    "timestamp" character varying(255)
);


ALTER TABLE public.dc_item_mappings OWNER TO postgres;

--
-- Name: dc_item_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dc_item_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.dc_item_mappings_id_seq OWNER TO postgres;

--
-- Name: dc_item_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dc_item_mappings_id_seq OWNED BY public.dc_item_mappings.id;


--
-- Name: delivery_challans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.delivery_challans (
    id character varying(255) NOT NULL,
    challanno text,
    customername text,
    deliverydate character varying(255),
    assetids text,
    status character varying(255),
    qrcode text,
    createdby text,
    "timestamp" character varying(255),
    payloadjson text
);


ALTER TABLE public.delivery_challans OWNER TO postgres;

--
-- Name: department_quotas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.department_quotas (
    department character varying(255) NOT NULL,
    category character varying(255) NOT NULL,
    quota integer
);


ALTER TABLE public.department_quotas OWNER TO postgres;

--
-- Name: employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employees (
    id character varying(255) NOT NULL,
    employeeid character varying(255),
    name text,
    department character varying(255),
    designation character varying(255),
    email character varying(255),
    phone character varying(255),
    status character varying(255),
    lastupdated character varying(255)
);


ALTER TABLE public.employees OWNER TO postgres;

--
-- Name: folders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.folders (
    id character varying(255) NOT NULL,
    name character varying(255),
    parentid character varying(255),
    icon character varying(255),
    module character varying(255),
    createdby character varying(255),
    "timestamp" character varying(255)
);


ALTER TABLE public.folders OWNER TO postgres;

--
-- Name: hsn_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hsn_codes (
    code character varying(255) NOT NULL,
    description character varying(255),
    gst_rate real
);


ALTER TABLE public.hsn_codes OWNER TO postgres;

--
-- Name: inventory_components; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_components (
    id character varying(255) NOT NULL,
    parentid character varying(255),
    itemname text NOT NULL,
    itemdescription text,
    status character varying(255) DEFAULT 'In Store'::character varying,
    make character varying(255),
    model character varying(255),
    srno character varying(255),
    type character varying(255) DEFAULT 'Component'::character varying,
    category character varying(255),
    lastupdated character varying(255),
    noqr integer DEFAULT 1,
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255)
);


ALTER TABLE public.inventory_components OWNER TO postgres;

--
-- Name: inventory_folders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_folders (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    parentid character varying(255),
    icon character varying(255) DEFAULT '📦'::character varying,
    module character varying(255) DEFAULT 'INVENTORY'::character varying,
    createdby character varying(255),
    "timestamp" character varying(255),
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255)
);


ALTER TABLE public.inventory_folders OWNER TO postgres;

--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_items (
    id character varying(255) NOT NULL,
    itemname text NOT NULL,
    itemdescription text,
    status character varying(255) DEFAULT 'In Store'::character varying,
    make character varying(255),
    model character varying(255),
    srno character varying(255),
    serialno character varying(255),
    type character varying(255),
    category character varying(255),
    icon text,
    parentid character varying(255),
    folderid character varying(255) NOT NULL,
    kindid character varying(255) NOT NULL,
    currentlocation text,
    remarks text,
    lastupdated character varying(255),
    currency character varying(255) DEFAULT 'INR'::character varying,
    asset_value real DEFAULT '0'::real,
    warranty_months integer DEFAULT 0,
    amc_months integer DEFAULT 0,
    quantity_total real DEFAULT '0'::real,
    quantity_available real DEFAULT '0'::real,
    quantity_precision integer DEFAULT 0,
    is_quantity_tracked integer DEFAULT 0,
    is_set integer DEFAULT 0,
    set_price_mode character varying(255),
    hsn_code character varying(255),
    weight real DEFAULT '0'::real,
    zoho_product_id character varying(255),
    catalog_uuid character varying(255),
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255),
    dispatchreceivedt character varying(255),
    purchasedetails text,
    purpose character varying(255),
    purchasedate character varying(255),
    warranty_tracking integer DEFAULT 1,
    quantity_unit character varying(255),
    quantity_note text,
    conversion_unit character varying(255),
    conversion_factor real,
    conversion_mode character varying(255),
    macaddress character varying(255),
    ipaddress character varying(255),
    networktype character varying(255),
    physicalport character varying(255),
    vlan character varying(255),
    socketid character varying(255),
    userid character varying(255),
    quantity_parent_id character varying(255),
    quantity_root_id character varying(255),
    quantity_updated_at character varying(255),
    is_batch integer DEFAULT 0
);


ALTER TABLE public.inventory_items OWNER TO postgres;

--
-- Name: inventory_kinds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_kinds (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    folderid character varying(255) NOT NULL,
    parentid character varying(255),
    module character varying(255) DEFAULT 'INVENTORY'::character varying,
    icon character varying(255) DEFAULT '📦'::character varying,
    displayimage character varying(255),
    identifier character varying(255),
    lastupdated character varying(255),
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255)
);


ALTER TABLE public.inventory_kinds OWNER TO postgres;

--
-- Name: inventory_quantity_event_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_quantity_event_lines (
    event_id integer NOT NULL,
    item_id character varying(255) NOT NULL,
    unit character varying(255),
    delta_available real DEFAULT '0'::real NOT NULL,
    delta_total real DEFAULT '0'::real NOT NULL
);


ALTER TABLE public.inventory_quantity_event_lines OWNER TO postgres;

--
-- Name: inventory_quantity_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_quantity_events (
    id integer NOT NULL,
    root_id character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    actor character varying(255),
    "timestamp" character varying(255) NOT NULL,
    note character varying(255),
    metadata_json text
);


ALTER TABLE public.inventory_quantity_events OWNER TO postgres;

--
-- Name: inventory_quantity_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventory_quantity_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.inventory_quantity_events_id_seq OWNER TO postgres;

--
-- Name: inventory_quantity_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventory_quantity_events_id_seq OWNED BY public.inventory_quantity_events.id;


--
-- Name: knex_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.knex_migrations (
    id integer NOT NULL,
    name character varying(255),
    batch integer,
    migration_time timestamp with time zone
);


ALTER TABLE public.knex_migrations OWNER TO postgres;

--
-- Name: knex_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.knex_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.knex_migrations_id_seq OWNER TO postgres;

--
-- Name: knex_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.knex_migrations_id_seq OWNED BY public.knex_migrations.id;


--
-- Name: knex_migrations_lock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.knex_migrations_lock (
    index integer NOT NULL,
    is_locked integer
);


ALTER TABLE public.knex_migrations_lock OWNER TO postgres;

--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.knex_migrations_lock_index_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.knex_migrations_lock_index_seq OWNER TO postgres;

--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNED BY public.knex_migrations_lock.index;


--
-- Name: layout_markers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.layout_markers (
    id character varying(255) NOT NULL,
    layoutid character varying(255),
    assetid character varying(255),
    x real,
    y real
);


ALTER TABLE public.layout_markers OWNER TO postgres;

--
-- Name: layouts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.layouts (
    id character varying(255) NOT NULL,
    name character varying(255),
    imageurl character varying(255),
    projectid character varying(255)
);


ALTER TABLE public.layouts OWNER TO postgres;

--
-- Name: oauthtoken; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauthtoken (
    user_mail character varying(100) NOT NULL,
    client_id character varying(100) NOT NULL,
    refresh_token character varying(255) NOT NULL,
    access_token character varying(255),
    grant_token character varying(255),
    expiry_time character varying(20)
);


ALTER TABLE public.oauthtoken OWNER TO postgres;

--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.password_resets (
    email character varying(255) NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.password_resets OWNER TO postgres;

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permissions (
    key character varying(255) NOT NULL,
    description character varying(255)
);


ALTER TABLE public.permissions OWNER TO postgres;

--
-- Name: project_assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.project_assets (
    projectid character varying(255) NOT NULL,
    assetid character varying(255) NOT NULL,
    assigneddate character varying(255),
    type character varying(255)
);


ALTER TABLE public.project_assets OWNER TO postgres;

--
-- Name: project_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.project_history (
    id integer NOT NULL,
    projectid character varying(255) NOT NULL,
    action character varying(255),
    "user" character varying(255),
    details text,
    "timestamp" character varying(255)
);


ALTER TABLE public.project_history OWNER TO postgres;

--
-- Name: project_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.project_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.project_history_id_seq OWNER TO postgres;

--
-- Name: project_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.project_history_id_seq OWNED BY public.project_history.id;


--
-- Name: project_order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.project_order_items (
    id integer NOT NULL,
    orderid character varying(255) NOT NULL,
    srno integer,
    itemdescription text,
    duedate character varying(255),
    qtyordered real,
    uom character varying(255),
    unitprice real,
    total real,
    assetid character varying(255),
    "timestamp" character varying(255),
    status character varying(255) DEFAULT 'Pending'::character varying
);


ALTER TABLE public.project_order_items OWNER TO postgres;

--
-- Name: project_order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.project_order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.project_order_items_id_seq OWNER TO postgres;

--
-- Name: project_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.project_order_items_id_seq OWNED BY public.project_order_items.id;


--
-- Name: project_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.project_orders (
    id character varying(255) NOT NULL,
    projectid character varying(255) NOT NULL,
    orderno text,
    orderdate character varying(255),
    consigneename text,
    consigneeaddress text,
    consigneegstin character varying(255),
    consigneestate character varying(255),
    consigneestatecode character varying(255),
    buyername text,
    buyeraddress text,
    buyergstin character varying(255),
    buyerstate character varying(255),
    buyerstatecode character varying(255),
    createdby character varying(255),
    "timestamp" character varying(255),
    ponumber text,
    podate character varying(255),
    vendorname text,
    totalamount real DEFAULT '0'::real,
    status character varying(255) DEFAULT 'Active'::character varying,
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255)
);


ALTER TABLE public.project_orders OWNER TO postgres;

--
-- Name: projects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.projects (
    id character varying(255) NOT NULL,
    projectname text NOT NULL,
    clientname text,
    description text,
    status character varying(255),
    startdate character varying(255),
    enddate character varying(255),
    createdby character varying(255),
    "timestamp" character varying(255),
    location text,
    currency character varying(255),
    owneremail text,
    coordinatoremail text,
    qrcode text,
    type character varying(255),
    consigneename text,
    consigneeaddress text,
    consigneegstin character varying(255),
    consigneestate character varying(255),
    consigneestatecode character varying(255),
    buyername text,
    buyeraddress text,
    buyergstin character varying(255),
    buyerstate character varying(255),
    buyerstatecode character varying(255),
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255),
    initials character varying(255),
    zoho_deal_id character varying(255),
    zoho_project_id_key character varying(255),
    sale_type character varying(255) DEFAULT 'Project'::character varying,
    zoho_account_id character varying(255)
);


ALTER TABLE public.projects OWNER TO postgres;

--
-- Name: quantity_event_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quantity_event_lines (
    event_id integer NOT NULL,
    asset_id character varying(255) NOT NULL,
    unit character varying(255),
    delta_available real DEFAULT '0'::real NOT NULL,
    delta_total real DEFAULT '0'::real NOT NULL
);


ALTER TABLE public.quantity_event_lines OWNER TO postgres;

--
-- Name: quantity_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quantity_events (
    id integer NOT NULL,
    root_id character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    actor character varying(255),
    "timestamp" character varying(255) NOT NULL,
    note character varying(255),
    metadata_json text
);


ALTER TABLE public.quantity_events OWNER TO postgres;

--
-- Name: quantity_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.quantity_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.quantity_events_id_seq OWNER TO postgres;

--
-- Name: quantity_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.quantity_events_id_seq OWNED BY public.quantity_events.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    role_name character varying(255) NOT NULL,
    permission_key character varying(255) NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    name character varying(255) NOT NULL,
    description character varying(255)
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: temporary_assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.temporary_assets (
    id character varying(255) NOT NULL,
    itemname character varying(255),
    make character varying(255),
    model character varying(255),
    type character varying(255),
    category character varying(255),
    status character varying(255),
    projectid character varying(255),
    ispermanent integer DEFAULT 0,
    estimatedprice real DEFAULT '0'::real,
    currency character varying(255) DEFAULT 'INR'::character varying,
    linked_po_item_id integer,
    "timestamp" character varying(255),
    is_deleted integer DEFAULT 0,
    deleted_at character varying(255)
);


ALTER TABLE public.temporary_assets OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    username character varying(255) NOT NULL,
    fullname text,
    password text NOT NULL,
    role character varying(255) DEFAULT 'user'::character varying,
    project_id character varying(255),
    client_id character varying(255),
    company_id character varying(255),
    employee_id character varying(255),
    department text,
    created_at character varying(255)
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: zoho_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.zoho_catalog (
    zoho_product_id character varying(255) NOT NULL,
    product_name character varying(255) NOT NULL,
    unit_price numeric(15,2) DEFAULT '0'::numeric,
    make character varying(255),
    model character varying(255),
    hsn_code character varying(255),
    description text,
    sku character varying(255),
    is_active boolean DEFAULT true,
    last_synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.zoho_catalog OWNER TO postgres;

--
-- Name: zoho_sync_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.zoho_sync_logs (
    id integer NOT NULL,
    module character varying(255) NOT NULL,
    operation character varying(255) NOT NULL,
    status character varying(255) NOT NULL,
    local_id character varying(255),
    zoho_id character varying(255),
    payload text,
    response text,
    error_message text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.zoho_sync_logs OWNER TO postgres;

--
-- Name: zoho_sync_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.zoho_sync_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.zoho_sync_logs_id_seq OWNER TO postgres;

--
-- Name: zoho_sync_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.zoho_sync_logs_id_seq OWNED BY public.zoho_sync_logs.id;


--
-- Name: arri_clients id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arri_clients ALTER COLUMN id SET DEFAULT nextval('public.arri_clients_id_seq'::regclass);


--
-- Name: asset_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_history ALTER COLUMN id SET DEFAULT nextval('public.asset_history_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: company_templates id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_templates ALTER COLUMN id SET DEFAULT nextval('public.company_templates_id_seq'::regclass);


--
-- Name: dc_item_mappings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_item_mappings ALTER COLUMN id SET DEFAULT nextval('public.dc_item_mappings_id_seq'::regclass);


--
-- Name: inventory_quantity_events id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_quantity_events ALTER COLUMN id SET DEFAULT nextval('public.inventory_quantity_events_id_seq'::regclass);


--
-- Name: knex_migrations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knex_migrations ALTER COLUMN id SET DEFAULT nextval('public.knex_migrations_id_seq'::regclass);


--
-- Name: knex_migrations_lock index; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knex_migrations_lock ALTER COLUMN index SET DEFAULT nextval('public.knex_migrations_lock_index_seq'::regclass);


--
-- Name: project_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_history ALTER COLUMN id SET DEFAULT nextval('public.project_history_id_seq'::regclass);


--
-- Name: project_order_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_order_items ALTER COLUMN id SET DEFAULT nextval('public.project_order_items_id_seq'::regclass);


--
-- Name: quantity_events id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quantity_events ALTER COLUMN id SET DEFAULT nextval('public.quantity_events_id_seq'::regclass);


--
-- Name: zoho_sync_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.zoho_sync_logs ALTER COLUMN id SET DEFAULT nextval('public.zoho_sync_logs_id_seq'::regclass);


--
-- Data for Name: arri_clients; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.arri_clients (id, name, address, contactperson, contactno, email, created_at) FROM stdin;
\.


--
-- Data for Name: arri_job_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.arri_job_cards (jobcardno, date, customername, customeraddress, contactperson, contactno, brandmake, modelname, serialno, receivingengineer, acc1, acc2, acc3, acc4, typeamc, typewarranty, typenowarranty, typeother, reportedproblem, actiontaken, faultfound, faultsn, partsreplaced, partssn, conclusion, invoiceto, invoiceno, invoicedate, estimatedvalue, created_at, status) FROM stdin;
\.


--
-- Data for Name: asset_hierarchy; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_hierarchy (id, parentid, assetid, "position") FROM stdin;
\.


--
-- Data for Name: asset_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_history (id, assetid, action, oldvalue, newvalue, "user", "timestamp", details) FROM stdin;
1	COM-MUM-0726-QTFYUH-3	CREATE	\N	In-Use	admin	2026-07-17 06:54:28.128+00	Initial assignment to: None
2	COM-SER-0726-L8NGCW-O	CREATE	\N	Scraped	admin	2026-07-21 11:56:48.574+00	Initial assignment to: None
3	COM-MUM-0726-QTFYUH-3	ASSIGNMENT_CHANGE	None	Anurag Ubhalkar	admin	2026-07-23 09:50:54.978+00	Personnel updated
4	COM-MUM-0726-QTFYUH-3	ASSIGNMENT_CHANGE	Anurag Ubhalkar	None	admin	2026-07-23 10:11:40.056+00	Personnel updated
5	COM-MUM-0726-QTFYUH-3	ASSIGNMENT_CHANGE	None	Anurag Ubhalkar	admin	2026-07-23 10:22:22.272+00	Personnel updated
6	COM-MUM-0726-QTFYUH-3	ASSIGNMENT_CHANGE	Anurag Ubhalkar	None	web	2026-07-23 10:22:33.125+00	Personnel updated
7	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	In-Use	In Store	web	2026-07-23 10:22:33.125+00	Status updated
8	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	In Store	Project	web	2026-07-23 10:22:58.973+00	Assigned to project manually
9	COM-MUM-0726-QTFYUH-3	ASSIGNMENT_CHANGE	Project: Sample	Anurag Ubhalkar	admin	2026-07-23 11:02:11.268+00	Personnel updated
10	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Project	Under Inspection	web	2026-07-23 11:02:23.487+00	Unassigned from project manually
11	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Under Inspection	In Store	admin	2026-07-23 11:07:10.97+00	Status updated
12	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	In Store	Project	web	2026-07-23 11:07:22.336+00	Assigned to project manually
13	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Project	Under Inspection	web	2026-07-23 11:07:48.702+00	Unassigned from project manually
14	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Under Inspection	In Store	admin	2026-07-23 11:07:48.716+00	Passed inspection. Condition: Good. 
15	COM-MUM-0726-QTFYUH-3	ASSIGNMENT_CHANGE	None	Anurag Ubhalkar	admin	2026-07-23 11:10:45.006+00	Personnel updated
16	COM-MUM-0726-QTFYUH-3	ASSIGNMENT_CHANGE	Anurag Ubhalkar	None	admin	2026-07-23 11:10:56.02+00	Personnel updated
17	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	In Store	Project	web	2026-07-23 11:11:19.008+00	Assigned to project manually
18	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Project	Under Inspection	web	2026-07-23 11:11:47.301+00	Unassigned from project manually
19	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Under Inspection	In Store	admin	2026-07-23 11:11:47.32+00	Passed inspection. Condition: Good. 
20	COM-MUM-0726-H51LDP-T	CREATE	\N	In Store	admin	2026-07-30 04:59:29.678+00	Initial assignment to: None
21	COM-MUM-0726-H51LDP-T	ASSIGNMENT_CHANGE	None	Anurag Ubhalkar	admin	2026-07-30 04:59:41.786+00	Personnel updated
22	COM-MUM-0726-H51LDP-T	ASSIGNMENT_CHANGE	Anurag Ubhalkar	None	admin	2026-07-30 05:16:47.277+00	Personnel updated
23	COM-MUM-0726-H51LDP-T	ASSIGNMENT_CHANGE	None	Anurag Ubhalkar	admin	2026-07-30 05:17:02.395+00	Personnel updated
24	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	In Store	Project	web	2026-07-30 05:48:37.752+00	Assigned to project manually
25	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Project	Under Inspection	web	2026-07-30 05:50:52.88+00	Unassigned from project manually
26	COM-MUM-0726-QTFYUH-3	STATUS_CHANGE	Under Inspection	In Store	admin	2026-07-30 05:50:52.899+00	Passed inspection. Condition: Average. 
27	COM-MUM-0726-H51LDP-T	STATUS_CHANGE	In Store	In-Use	admin	2026-07-30 06:03:52.58+00	Status updated
\.


--
-- Data for Name: asset_it_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_it_details (assetid, macaddress, ipaddress, networktype, physicalport, vlan, socketid, userid) FROM stdin;
COM-SER-0726-L8NGCW-O			DHCP				
COM-MUM-0726-H51LDP-T			DHCP				
COM-MUM-0726-QTFYUH-3			DHCP				
\.


--
-- Data for Name: asset_kinds; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_kinds (name, module, icon, parentname, lastupdated, displayimage, identifier, is_deleted, deleted_at) FROM stdin;
Computing Devices	IT	📦	Cineom Assets	2026-07-17T06:52:56.466Z	\N	CDS	0	\N
\.


--
-- Data for Name: assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.assets (id, no, itemname, itemdescription, status, make, model, srno, serialno, type, category, icon, isplaceholder, parentid, currentlocation, previouslocation, dispatchreceivedt, purchasedetails, remarks, purpose, purchasedate, lastupdated, qrcode, assignedto, macaddress, ipaddress, networktype, physicalport, vlan, socketid, userid, noqr, currency, asset_value, warranty_months, amc_months, quantity_parent_id, quantity_root_id, quantity_unit, quantity_total, quantity_available, quantity_precision, quantity_updated_at, conversion_unit, conversion_factor, conversion_mode, is_quantity_tracked, warranty_tracking, boughtagainstpo, sentagainstdc, is_batch, linked_po_item_id, is_deleted, deleted_at, department, company_id, is_set, set_price_mode, weight, client_label, parent_folder, zoho_product_id, hsn_code, is_retired, condition) FROM stdin;
COM-SER-0726-L8NGCW-O	\N	asda	\N	Scraped	asdasd	asd xa 	det:41c0671be00b8858da75a9df84b7bc6a	\N	Computing Devices	IT		0	\N	Server Room	\N		Purchased via PO:  from  on 2026-05-21	PO Item conversion. Original Qty: 1 Nos	\N	2026-07-23	2026-07-21T11:56:48.543Z	data:image/png;base64,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		\N	\N	\N	\N	\N	\N	\N	0	USD	0	5	4	\N	\N	\N	\N	\N	\N	\N	\N	\N	multiply	0	0	\N	\N	0	\N	1	2026-07-21T11:57:05.444Z	\N	\N	0	SUM_OF_CHILDREN	\N	COM-SER-L8NGCW	Cineom Assets	\N	\N	0	Good
COM-MUM-0726-QTFYUH-3	\N	Lenovo LOQ		In Store	Lenovo	89G-5	det:be14e91a938fd798a48e82dbf43bbdc6ff1e901b7f9e2fc42e7ea4f01fc677d0	\N	Computing Devices	IT		0	COM-MUM-0726-H51LDP-T	Mumbai	\N	2026-07-18			Owned	2026-06-25	2026-07-30T06:10:10.952Z	data:image/png;base64,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		\N	\N	\N	\N	\N	\N	\N	0	USD	0	5	0	\N	COM-MUM-0726-QTFYUH-3	Pcs	2	2	0	2026-07-30T06:08:20.653Z		\N	multiply	1	1	\N	\N	1	\N	0	\N	\N	\N	0	SUM_OF_CHILDREN		COM-MUM-QTFYUH	Cineom Assets	\N		0	Average
COM-MUM-0726-H51LDP-T	\N	Sample Test		In-Use	Samp	Smple	det:4b94a10fe3d797976df9e9278829c263	\N	Computing Devices	IT		0	\N	Mumbai	\N	2026-07-16	Purchased becasue i have lot of monies	Late Mark	\N	2026-07-09	2026-07-30T06:03:52.573Z	data:image/png;base64,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	Anurag Ubhalkar	\N	\N	\N	\N	\N	\N	\N	0	USD	0	6	9	\N	\N	\N	0	\N	0	\N		\N	multiply	0	1	\N	\N	0	\N	0	\N	\N	\N	0	SUM_OF_CHILDREN		COM-MUM-H51LDP	Cineom Assets	\N		0	Good
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_log (id, action, "user", assetid, severity, details, "timestamp") FROM stdin;
1	CREATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset created: Lenovo LOQ (Computing Devices)	2026-07-17T06:54:28.128Z
2	CREATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset created: Lenovo LOQ	2026-07-17T06:54:28.140Z
3	CREATE	admin	COM-SER-0726-L8NGCW-O	INFO	Asset created: asda (Computing Devices)	2026-07-21T11:56:48.574Z
4	CREATE	admin	COM-SER-0726-L8NGCW-O	INFO	Asset created: asda	2026-07-21T11:56:48.588Z
5	DELETE	web	COM-SER-0726-L8NGCW-O	INFO	Asset marked for deletion (30-day grace period)	2026-07-21T11:57:05.472Z
6	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:43:38.281Z
7	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:49:14.638Z
8	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:50:54.978Z
9	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:51:11.527Z
10	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:51:32.747Z
11	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:52:04.057Z
12	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:52:13.120Z
13	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:58:16.769Z
14	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T09:59:09.926Z
15	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T10:11:40.056Z
16	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T10:12:13.368Z
17	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T10:22:22.272Z
18	UPDATE	web	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T10:22:33.125Z
19	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T11:02:11.268Z
20	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T11:07:10.969Z
21	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T11:10:45.006Z
22	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-23T11:10:56.019Z
23	CREATE	admin	COM-MUM-0726-H51LDP-T	INFO	Asset created: Sample Test (Computing Devices)	2026-07-30T04:59:29.678Z
24	CREATE	admin	COM-MUM-0726-H51LDP-T	INFO	Asset created: Sample Test	2026-07-30T04:59:29.692Z
25	UPDATE	admin	COM-MUM-0726-H51LDP-T	INFO	Asset updated: Sample Test	2026-07-30T04:59:41.786Z
26	UPDATE	admin	COM-MUM-0726-H51LDP-T	INFO	Asset updated: Sample Test	2026-07-30T05:16:47.276Z
27	UPDATE	admin	COM-MUM-0726-H51LDP-T	INFO	Asset updated: Sample Test	2026-07-30T05:17:02.395Z
28	UPDATE	admin	COM-MUM-0726-H51LDP-T	INFO	Asset updated: Sample Test	2026-07-30T05:47:32.482Z
29	UPDATE	admin	COM-MUM-0726-H51LDP-T	INFO	Asset updated: Sample Test	2026-07-30T06:03:52.579Z
30	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-30T06:08:20.640Z
31	UPDATE	admin	COM-MUM-0726-QTFYUH-3	INFO	Asset updated: Lenovo LOQ	2026-07-30T06:10:10.955Z
\.


--
-- Data for Name: auth_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.auth_tokens (user_id, token_hash, expires_at, created_at) FROM stdin;
admin	09a8ec102c8c7c99e7327a8f81d80a2187be54545fff122f3a1b7d9558368a37	2026-08-22 09:40:23.383+00	2026-07-23 09:40:23.384416+00
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.companies (id, name, created_at) FROM stdin;
5be59c39-f4d7-4f58-9100-8cca84a58760	CINEOM	\N
00000000-0000-0000-0000-000000000001	CINEOM	\N
\.


--
-- Data for Name: company_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.company_templates (id, company_id, template_type, template_data, created_at, name, company_name, address, gst, cin, state_name, state_code, is_default) FROM stdin;
\.


--
-- Data for Name: components; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.components (id, parentid, type, name, description, weight, itemname, make, model, srno, status, category, lastupdated, noqr) FROM stdin;
\.


--
-- Data for Name: dc_item_mappings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dc_item_mappings (id, dc_id, assetid, customname, customdescription, "timestamp") FROM stdin;
\.


--
-- Data for Name: delivery_challans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.delivery_challans (id, challanno, customername, deliverydate, assetids, status, qrcode, createdby, "timestamp", payloadjson) FROM stdin;
\.


--
-- Data for Name: department_quotas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.department_quotas (department, category, quota) FROM stdin;
\.


--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employees (id, employeeid, name, department, designation, email, phone, status, lastupdated) FROM stdin;
EMP1784800246681	1198	Anurag Ubhalkar	IT 	IT Executive	itdevelopment@cineom.in	+91 9702366345	ACTIVE	2026-07-23T09:50:46.681Z
\.


--
-- Data for Name: folders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.folders (id, name, parentid, icon, module, createdby, "timestamp") FROM stdin;
F1784271149074	Cineom Assets	\N	📁	IT	system	2026-07-17T06:52:29.074Z
\.


--
-- Data for Name: hsn_codes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.hsn_codes (code, description, gst_rate) FROM stdin;
\.


--
-- Data for Name: inventory_components; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_components (id, parentid, itemname, itemdescription, status, make, model, srno, type, category, lastupdated, noqr, is_deleted, deleted_at) FROM stdin;
\.


--
-- Data for Name: inventory_folders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_folders (id, name, parentid, icon, module, createdby, "timestamp", is_deleted, deleted_at) FROM stdin;
IF-1785396075252-544	Sample Inventory	\N	📦	INVENTORY	admin	2026-07-30T07:21:15.252Z	0	\N
IF-INBOX	Inbox	\N	📥	INVENTORY	system	2026-07-30 12:02:55	0	\N
\.


--
-- Data for Name: inventory_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_items (id, itemname, itemdescription, status, make, model, srno, serialno, type, category, icon, parentid, folderid, kindid, currentlocation, remarks, lastupdated, currency, asset_value, warranty_months, amc_months, quantity_total, quantity_available, quantity_precision, is_quantity_tracked, is_set, set_price_mode, hsn_code, weight, zoho_product_id, catalog_uuid, is_deleted, deleted_at, dispatchreceivedt, purchasedetails, purpose, purchasedate, warranty_tracking, quantity_unit, quantity_note, conversion_unit, conversion_factor, conversion_mode, macaddress, ipaddress, networktype, physicalport, vlan, socketid, userid, quantity_parent_id, quantity_root_id, quantity_updated_at, is_batch) FROM stdin;
TES-MUM-0726-750P78-0	Test		In Store	Good	Better	\N	\N	Test	Test	📦	\N	IF-1785396075252-544	IK-1785396918287-850	Mumbai		2026-07-30T11:23:15.838Z	INR	0	0	0	1	1	0	1	0	\N	\N	0	\N	\N	0	\N	\N		Owned	\N	1	Nos	\N	\N	0	multiply	\N	\N	DHCP	\N	\N	\N	\N	\N	TES-MUM-0726-750P78-0	2026-07-30T11:23:15.838Z	0
INV-MUM-0726-JALDY0-R	Inventory Sample	Sample	In Store	Good	Better	\N	\N	Inventory	Inventory	\N	TES-MUM-0726-750P78-0	IF-INBOX	IK-MISC	Mumbai		2026-07-30T07:06:37.892Z	INR	0	0	0	1	1	0	1	0	\N	\N	0	\N	\N	0	\N	\N	\N	\N	\N	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0
\.


--
-- Data for Name: inventory_kinds; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_kinds (id, name, folderid, parentid, module, icon, displayimage, identifier, lastupdated, is_deleted, deleted_at) FROM stdin;
IK-1785396918287-850	Test	IF-1785396075252-544	\N	INVENTORY	📦	\N	\N	2026-07-30T07:35:18.287Z	0	\N
IK-1785410642329-75	Biggin	IF-1785396075252-544	IK-1785396918287-850	INVENTORY	📦	\N	\N	2026-07-30T11:24:02.331Z	0	\N
IK-1785412508798-227	Smallin	IF-1785396075252-544	IK-1785396918287-850	INVENTORY	📦	\N	\N	2026-07-30T11:55:08.803Z	0	\N
IK-MISC	Misc	IF-INBOX	\N	INVENTORY	📦	\N	\N	2026-07-30 12:02:55	0	\N
\.


--
-- Data for Name: inventory_quantity_event_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_quantity_event_lines (event_id, item_id, unit, delta_available, delta_total) FROM stdin;
2	TES-MUM-0726-750P78-0	Nos	1	1
\.


--
-- Data for Name: inventory_quantity_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_quantity_events (id, root_id, type, actor, "timestamp", note, metadata_json) FROM stdin;
2	TES-MUM-0726-750P78-0	ADJUST	admin	2026-07-30T11:23:15.847Z	Updated quantity	{"prev_quantity_total":0,"new_quantity_total":1,"prev_quantity_available":0,"new_quantity_available":1}
\.


--
-- Data for Name: knex_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.knex_migrations (id, name, batch, migration_time) FROM stdin;
1	20260417060510_create_initial_schema.js	1	2026-07-01 09:44:12.288+00
2	20260430120000_add_auth_tables.js	1	2026-07-01 09:44:12.312+00
3	20260430130000_add_company_id_to_assets.js	1	2026-07-01 09:44:12.33+00
4	20260527120000_add_set_logic_to_assets.js	1	2026-07-01 09:44:12.333+00
5	20260529000000_add_retirement_logic.js	1	2026-07-01 09:44:12.334+00
6	20260529000001_add_condition_and_hsn.js	1	2026-07-01 09:44:12.34+00
7	20260530000002_add_cross_table_constraints.js	1	2026-07-01 09:44:12.36+00
8	20260615000001_add_weight_to_assets.js	1	2026-07-01 09:44:12.362+00
9	20260629052100_add_arri_tables.js	1	2026-07-01 09:44:12.388+00
10	20260703000000_fix_schema_mismatch.js	2	2026-07-13 07:58:25.647+00
11	20260721093000_add_fk_wave1_for_9090.js	3	2026-07-21 10:34:30.825+00
12	20260721100500_add_fk_wave2_for_9090.js	4	2026-07-21 11:41:07.383+00
13	20260721104000_add_fk_wave3_for_9090.js	5	2026-07-21 11:48:12.409+00
14	20260716062949_create_zoho_tokens_table.js	6	2026-07-22 09:07:29.97+00
15	20260717063620_add_zoho_mapping_fields.js	6	2026-07-22 09:07:30+00
16	20260717081322_create_zoho_catalog_table.js	6	2026-07-22 09:07:30.023+00
17	20260720071943_create_zoho_sync_logs.js	6	2026-07-22 09:07:30.044+00
18	20260722123000_add_fk_wave4_hierarchy_for_9090.js	6	2026-07-22 09:07:30.125+00
19	20260723093000_add_itemdescription_to_assets.js	7	2026-07-23 07:09:21.384+00
20	20260723101500_add_hsn_code_and_is_retired_to_assets.js	7	2026-07-23 07:09:21.415+00
21	20260723113000_expand_company_templates_schema.js	8	2026-07-23 09:27:53.177+00
22	20260723114500_expand_components_schema.js	9	2026-07-23 09:45:01.359+00
23	20260723120500_add_missing_condition_to_assets.js	10	2026-07-23 11:05:45.475+00
24	20260730090000_create_inventory_preview_tables.js	11	2026-07-30 06:42:42.609+00
25	20260730094500_expand_inventory_items_modal_parity.js	12	2026-07-30 09:24:13.235+00
26	20260730101500_inventory_components_and_qty_events_preview.js	13	2026-07-30 09:53:34.06+00
27	20260730112000_add_inventory_is_batch_preview.js	14	2026-07-30 10:55:13.347+00
28	20260730123000_inventory_fk_hardening_preview.js	15	2026-07-30 12:02:55.627+00
29	20260804090000_seed_sample_zoho_catalog_product_preview.js	16	2026-08-04 07:25:25.418+00
\.


--
-- Data for Name: knex_migrations_lock; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.knex_migrations_lock (index, is_locked) FROM stdin;
1	0
\.


--
-- Data for Name: layout_markers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.layout_markers (id, layoutid, assetid, x, y) FROM stdin;
\.


--
-- Data for Name: layouts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.layouts (id, name, imageurl, projectid) FROM stdin;
\.


--
-- Data for Name: oauthtoken; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.oauthtoken (user_mail, client_id, refresh_token, access_token, grant_token, expiry_time) FROM stdin;
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.password_resets (email, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permissions (key, description) FROM stdin;
view.dashboard	Access to main dashboard
manage.hierarchy	Add/Edit/Delete folders and categories
manage.assets	Add/Edit/Delete individual assets
view.arri	Access to ARRI Service Portal
manage.arri	Create and Edit ARRI Job Cards
view.projects	Access to Projects module
manage.projects	Create and Edit Projects
view.dc	Access to Delivery Challans
manage.dc	Create and Edit DCs
view.warranty	Access to Warranty tracker
manage.warranty	Update Warranty information
view.admin	Access to Admin panel
manage.rbac	Manage roles and permissions
view.releases	Access to Release notes
\.


--
-- Data for Name: project_assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.project_assets (projectid, assetid, assigneddate, type) FROM stdin;
\.


--
-- Data for Name: project_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.project_history (id, projectid, action, "user", details, "timestamp") FROM stdin;
\.


--
-- Data for Name: project_order_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.project_order_items (id, orderid, srno, itemdescription, duedate, qtyordered, uom, unitprice, total, assetid, "timestamp", status) FROM stdin;
\.


--
-- Data for Name: project_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.project_orders (id, projectid, orderno, orderdate, consigneename, consigneeaddress, consigneegstin, consigneestate, consigneestatecode, buyername, buyeraddress, buyergstin, buyerstate, buyerstatecode, createdby, "timestamp", ponumber, podate, vendorname, totalamount, status, is_deleted, deleted_at) FROM stdin;
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.projects (id, projectname, clientname, description, status, startdate, enddate, createdby, "timestamp", location, currency, owneremail, coordinatoremail, qrcode, type, consigneename, consigneeaddress, consigneegstin, consigneestate, consigneestatecode, buyername, buyeraddress, buyergstin, buyerstate, buyerstatecode, is_deleted, deleted_at, initials, zoho_deal_id, zoho_project_id_key, sale_type, zoho_account_id) FROM stdin;
MUM-0726-365241-P	Sample	Sample	\N	Active	2026-06-18	2026-07-18	admin	2026-07-23T10:11:27.904Z	MUMBAI	INR	\N	\N	data:image/png;base64,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	\N	Sample	\N	\N	\N	\N	Sample	\N	\N	\N	\N	0	\N	SMP	\N	\N	Project	\N
\.


--
-- Data for Name: quantity_event_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quantity_event_lines (event_id, asset_id, unit, delta_available, delta_total) FROM stdin;
1	COM-MUM-0726-QTFYUH-3	Pcs	2	2
\.


--
-- Data for Name: quantity_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quantity_events (id, root_id, type, actor, "timestamp", note, metadata_json) FROM stdin;
1	COM-MUM-0726-QTFYUH-3	INIT	admin	2026-07-30T06:08:20.653Z	\N	{"source":"asset_update_init"}
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permissions (role_name, permission_key) FROM stdin;
superuser	view.dashboard
superuser	manage.hierarchy
superuser	manage.assets
superuser	view.arri
superuser	manage.arri
superuser	view.projects
superuser	manage.projects
superuser	view.dc
superuser	manage.dc
superuser	view.warranty
superuser	manage.warranty
superuser	view.admin
superuser	manage.rbac
superuser	view.releases
admin	view.dashboard
admin	manage.hierarchy
admin	manage.assets
admin	view.arri
admin	manage.arri
admin	view.projects
admin	view.dc
admin	view.warranty
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (name, description) FROM stdin;
superuser	System-wide superuser with all access
admin	Administrator with management access
user	Standard user with view access
\.


--
-- Data for Name: temporary_assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.temporary_assets (id, itemname, make, model, type, category, status, projectid, ispermanent, estimatedprice, currency, linked_po_item_id, "timestamp", is_deleted, deleted_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (username, fullname, password, role, project_id, client_id, company_id, employee_id, department, created_at) FROM stdin;
admin	System Administrator	$2a$12$8RnrciSZLpra605lMTBBROQnhNUw8gQ.Wk0GbqytTShI8JgZsJEZ2	superuser	\N	5be59c39-f4d7-4f58-9100-8cca84a58760	5be59c39-f4d7-4f58-9100-8cca84a58760	\N	\N	\N
\.


--
-- Data for Name: zoho_catalog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.zoho_catalog (zoho_product_id, product_name, unit_price, make, model, hsn_code, description, sku, is_active, last_synced_at, created_at) FROM stdin;
ZP-SAMPLE-0001	Sample Catalog Product (Hardcoded)	25000.00	CINEOM	SAMPLE-MODEL-1	9987	Hardcoded sample catalog product for testing catalog → inventory conversion flow.	SAMPLE-001	t	2026-08-04 07:25:25.393278+00	2026-08-04 07:25:25.393278+00
\.


--
-- Data for Name: zoho_sync_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.zoho_sync_logs (id, module, operation, status, local_id, zoho_id, payload, response, error_message, created_at) FROM stdin;
\.


--
-- Name: arri_clients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.arri_clients_id_seq', 1, false);


--
-- Name: asset_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_history_id_seq', 27, true);


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 31, true);


--
-- Name: company_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.company_templates_id_seq', 1, false);


--
-- Name: dc_item_mappings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dc_item_mappings_id_seq', 1, false);


--
-- Name: inventory_quantity_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_quantity_events_id_seq', 2, true);


--
-- Name: knex_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.knex_migrations_id_seq', 29, true);


--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.knex_migrations_lock_index_seq', 1, true);


--
-- Name: project_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.project_history_id_seq', 1, false);


--
-- Name: project_order_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.project_order_items_id_seq', 1, false);


--
-- Name: quantity_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.quantity_events_id_seq', 1, true);


--
-- Name: zoho_sync_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.zoho_sync_logs_id_seq', 1, false);


--
-- Name: arri_clients arri_clients_name_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arri_clients
    ADD CONSTRAINT arri_clients_name_unique UNIQUE (name);


--
-- Name: arri_clients arri_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arri_clients
    ADD CONSTRAINT arri_clients_pkey PRIMARY KEY (id);


--
-- Name: arri_job_cards arri_job_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arri_job_cards
    ADD CONSTRAINT arri_job_cards_pkey PRIMARY KEY (jobcardno);


--
-- Name: asset_hierarchy asset_hierarchy_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_hierarchy
    ADD CONSTRAINT asset_hierarchy_pkey PRIMARY KEY (id);


--
-- Name: asset_history asset_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_history
    ADD CONSTRAINT asset_history_pkey PRIMARY KEY (id);


--
-- Name: asset_it_details asset_it_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_it_details
    ADD CONSTRAINT asset_it_details_pkey PRIMARY KEY (assetid);


--
-- Name: asset_kinds asset_kinds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_kinds
    ADD CONSTRAINT asset_kinds_pkey PRIMARY KEY (name);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auth_tokens auth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_tokens
    ADD CONSTRAINT auth_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_templates company_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_pkey PRIMARY KEY (id);


--
-- Name: components components_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (id);


--
-- Name: dc_item_mappings dc_item_mappings_dc_id_assetid_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_item_mappings
    ADD CONSTRAINT dc_item_mappings_dc_id_assetid_unique UNIQUE (dc_id, assetid);


--
-- Name: dc_item_mappings dc_item_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_item_mappings
    ADD CONSTRAINT dc_item_mappings_pkey PRIMARY KEY (id);


--
-- Name: delivery_challans delivery_challans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challans
    ADD CONSTRAINT delivery_challans_pkey PRIMARY KEY (id);


--
-- Name: department_quotas department_quotas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.department_quotas
    ADD CONSTRAINT department_quotas_pkey PRIMARY KEY (department, category);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: folders folders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);


--
-- Name: hsn_codes hsn_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hsn_codes
    ADD CONSTRAINT hsn_codes_pkey PRIMARY KEY (code);


--
-- Name: inventory_components inventory_components_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_components
    ADD CONSTRAINT inventory_components_pkey PRIMARY KEY (id);


--
-- Name: inventory_folders inventory_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_folders
    ADD CONSTRAINT inventory_folders_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_kinds inventory_kinds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_kinds
    ADD CONSTRAINT inventory_kinds_pkey PRIMARY KEY (id);


--
-- Name: inventory_quantity_event_lines inventory_quantity_event_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_quantity_event_lines
    ADD CONSTRAINT inventory_quantity_event_lines_pkey PRIMARY KEY (event_id, item_id);


--
-- Name: inventory_quantity_events inventory_quantity_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_quantity_events
    ADD CONSTRAINT inventory_quantity_events_pkey PRIMARY KEY (id);


--
-- Name: knex_migrations_lock knex_migrations_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knex_migrations_lock
    ADD CONSTRAINT knex_migrations_lock_pkey PRIMARY KEY (index);


--
-- Name: knex_migrations knex_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knex_migrations
    ADD CONSTRAINT knex_migrations_pkey PRIMARY KEY (id);


--
-- Name: layout_markers layout_markers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layout_markers
    ADD CONSTRAINT layout_markers_pkey PRIMARY KEY (id);


--
-- Name: layouts layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layouts
    ADD CONSTRAINT layouts_pkey PRIMARY KEY (id);


--
-- Name: oauthtoken oauthtoken_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauthtoken
    ADD CONSTRAINT oauthtoken_pkey PRIMARY KEY (user_mail, client_id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (token_hash);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (key);


--
-- Name: project_assets project_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_assets
    ADD CONSTRAINT project_assets_pkey PRIMARY KEY (projectid, assetid);


--
-- Name: project_history project_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_history
    ADD CONSTRAINT project_history_pkey PRIMARY KEY (id);


--
-- Name: project_order_items project_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_order_items
    ADD CONSTRAINT project_order_items_pkey PRIMARY KEY (id);


--
-- Name: project_orders project_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_orders
    ADD CONSTRAINT project_orders_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: quantity_event_lines quantity_event_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quantity_event_lines
    ADD CONSTRAINT quantity_event_lines_pkey PRIMARY KEY (event_id, asset_id);


--
-- Name: quantity_events quantity_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quantity_events
    ADD CONSTRAINT quantity_events_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_name, permission_key);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (name);


--
-- Name: temporary_assets temporary_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.temporary_assets
    ADD CONSTRAINT temporary_assets_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (username);


--
-- Name: zoho_catalog zoho_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.zoho_catalog
    ADD CONSTRAINT zoho_catalog_pkey PRIMARY KEY (zoho_product_id);


--
-- Name: zoho_sync_logs zoho_sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.zoho_sync_logs
    ADD CONSTRAINT zoho_sync_logs_pkey PRIMARY KEY (id);


--
-- Name: idx_asset_hierarchy_assetid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_asset_hierarchy_assetid ON public.asset_hierarchy USING btree (assetid);


--
-- Name: idx_asset_hierarchy_parentid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_asset_hierarchy_parentid ON public.asset_hierarchy USING btree (parentid);


--
-- Name: idx_assets_linked_po_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assets_linked_po_item_id ON public.assets USING btree (linked_po_item_id);


--
-- Name: idx_assets_parentid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assets_parentid ON public.assets USING btree (parentid);


--
-- Name: idx_audit_log_assetid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_log_assetid ON public.audit_log USING btree (assetid);


--
-- Name: idx_components_parentid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_components_parentid ON public.components USING btree (parentid);


--
-- Name: idx_dc_item_mappings_assetid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dc_item_mappings_assetid ON public.dc_item_mappings USING btree (assetid);


--
-- Name: idx_folders_parentid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_folders_parentid ON public.folders USING btree (parentid);


--
-- Name: idx_inventory_folders_parentid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_folders_parentid ON public.inventory_folders USING btree (parentid);


--
-- Name: idx_inventory_items_folderid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_items_folderid ON public.inventory_items USING btree (folderid);


--
-- Name: idx_inventory_items_kindid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_items_kindid ON public.inventory_items USING btree (kindid);


--
-- Name: idx_inventory_items_parentid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_items_parentid ON public.inventory_items USING btree (parentid);


--
-- Name: idx_inventory_kinds_folderid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_kinds_folderid ON public.inventory_kinds USING btree (folderid);


--
-- Name: idx_inventory_kinds_parentid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_kinds_parentid ON public.inventory_kinds USING btree (parentid);


--
-- Name: idx_inventory_quantity_event_lines_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_quantity_event_lines_item_id ON public.inventory_quantity_event_lines USING btree (item_id);


--
-- Name: idx_inventory_quantity_events_root_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_quantity_events_root_id ON public.inventory_quantity_events USING btree (root_id);


--
-- Name: idx_layout_markers_assetid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_layout_markers_assetid ON public.layout_markers USING btree (assetid);


--
-- Name: idx_project_assets_assetid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_project_assets_assetid ON public.project_assets USING btree (assetid);


--
-- Name: idx_project_history_projectid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_project_history_projectid ON public.project_history USING btree (projectid);


--
-- Name: idx_project_order_items_assetid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_project_order_items_assetid ON public.project_order_items USING btree (assetid);


--
-- Name: idx_project_order_items_orderid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_project_order_items_orderid ON public.project_order_items USING btree (orderid);


--
-- Name: idx_project_orders_projectid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_project_orders_projectid ON public.project_orders USING btree (projectid);


--
-- Name: idx_temporary_assets_linked_po_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_temporary_assets_linked_po_item_id ON public.temporary_assets USING btree (linked_po_item_id);


--
-- Name: idx_temporary_assets_projectid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_temporary_assets_projectid ON public.temporary_assets USING btree (projectid);


--
-- Name: idx_users_company_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_company_id ON public.users USING btree (company_id);


--
-- Name: idx_users_project_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_project_id ON public.users USING btree (project_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: inventory_components_parentid_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_components_parentid_index ON public.inventory_components USING btree (parentid);


--
-- Name: inventory_folders_parentid_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_folders_parentid_index ON public.inventory_folders USING btree (parentid);


--
-- Name: inventory_items_folderid_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_items_folderid_index ON public.inventory_items USING btree (folderid);


--
-- Name: inventory_items_kindid_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_items_kindid_index ON public.inventory_items USING btree (kindid);


--
-- Name: inventory_items_parentid_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_items_parentid_index ON public.inventory_items USING btree (parentid);


--
-- Name: inventory_items_zoho_product_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_items_zoho_product_id_index ON public.inventory_items USING btree (zoho_product_id);


--
-- Name: inventory_kinds_folderid_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_kinds_folderid_index ON public.inventory_kinds USING btree (folderid);


--
-- Name: inventory_kinds_parentid_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_kinds_parentid_index ON public.inventory_kinds USING btree (parentid);


--
-- Name: inventory_quantity_event_lines_item_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_quantity_event_lines_item_id_index ON public.inventory_quantity_event_lines USING btree (item_id);


--
-- Name: inventory_quantity_events_root_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_quantity_events_root_id_index ON public.inventory_quantity_events USING btree (root_id);


--
-- Name: assets trg_check_assets_dup; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_check_assets_dup BEFORE INSERT OR UPDATE OF id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.check_cross_table_id_duplication();


--
-- Name: components trg_check_components_dup; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_check_components_dup BEFORE INSERT OR UPDATE OF id ON public.components FOR EACH ROW EXECUTE FUNCTION public.check_cross_table_id_duplication();


--
-- Name: auth_tokens auth_tokens_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_tokens
    ADD CONSTRAINT auth_tokens_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(username) ON DELETE CASCADE;


--
-- Name: asset_hierarchy fk_asset_hierarchy_assetid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_hierarchy
    ADD CONSTRAINT fk_asset_hierarchy_assetid_assets FOREIGN KEY (assetid) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: asset_hierarchy fk_asset_hierarchy_parentid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_hierarchy
    ADD CONSTRAINT fk_asset_hierarchy_parentid_assets FOREIGN KEY (parentid) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: asset_it_details fk_asset_it_details_assetid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_it_details
    ADD CONSTRAINT fk_asset_it_details_assetid_assets FOREIGN KEY (assetid) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: assets fk_assets_linked_po_item_id_project_order_items; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT fk_assets_linked_po_item_id_project_order_items FOREIGN KEY (linked_po_item_id) REFERENCES public.project_order_items(id) ON DELETE SET NULL;


--
-- Name: assets fk_assets_parentid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT fk_assets_parentid_assets FOREIGN KEY (parentid) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: audit_log fk_audit_log_assetid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT fk_audit_log_assetid_assets FOREIGN KEY (assetid) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: components fk_components_parentid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT fk_components_parentid_assets FOREIGN KEY (parentid) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: dc_item_mappings fk_dc_item_mappings_assetid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_item_mappings
    ADD CONSTRAINT fk_dc_item_mappings_assetid_assets FOREIGN KEY (assetid) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: dc_item_mappings fk_dc_item_mappings_dc_id_delivery_challans; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_item_mappings
    ADD CONSTRAINT fk_dc_item_mappings_dc_id_delivery_challans FOREIGN KEY (dc_id) REFERENCES public.delivery_challans(id) ON DELETE CASCADE;


--
-- Name: folders fk_folders_parentid_folders; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT fk_folders_parentid_folders FOREIGN KEY (parentid) REFERENCES public.folders(id);


--
-- Name: inventory_components fk_inventory_components_parentid_inventory_items; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_components
    ADD CONSTRAINT fk_inventory_components_parentid_inventory_items FOREIGN KEY (parentid) REFERENCES public.inventory_items(id) ON DELETE SET NULL;


--
-- Name: inventory_folders fk_inventory_folders_parentid_inventory_folders; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_folders
    ADD CONSTRAINT fk_inventory_folders_parentid_inventory_folders FOREIGN KEY (parentid) REFERENCES public.inventory_folders(id) ON DELETE SET NULL;


--
-- Name: inventory_items fk_inventory_items_folderid_inventory_folders; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT fk_inventory_items_folderid_inventory_folders FOREIGN KEY (folderid) REFERENCES public.inventory_folders(id) ON DELETE RESTRICT;


--
-- Name: inventory_items fk_inventory_items_kindid_inventory_kinds; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT fk_inventory_items_kindid_inventory_kinds FOREIGN KEY (kindid) REFERENCES public.inventory_kinds(id) ON DELETE RESTRICT;


--
-- Name: inventory_items fk_inventory_items_parentid_inventory_items; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT fk_inventory_items_parentid_inventory_items FOREIGN KEY (parentid) REFERENCES public.inventory_items(id) ON DELETE SET NULL;


--
-- Name: inventory_kinds fk_inventory_kinds_folderid_inventory_folders; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_kinds
    ADD CONSTRAINT fk_inventory_kinds_folderid_inventory_folders FOREIGN KEY (folderid) REFERENCES public.inventory_folders(id) ON DELETE RESTRICT;


--
-- Name: inventory_kinds fk_inventory_kinds_parentid_inventory_kinds; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_kinds
    ADD CONSTRAINT fk_inventory_kinds_parentid_inventory_kinds FOREIGN KEY (parentid) REFERENCES public.inventory_kinds(id) ON DELETE SET NULL;


--
-- Name: inventory_quantity_event_lines fk_inventory_quantity_event_lines_itemid_inventory_items; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_quantity_event_lines
    ADD CONSTRAINT fk_inventory_quantity_event_lines_itemid_inventory_items FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: inventory_quantity_events fk_inventory_quantity_events_rootid_inventory_items; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_quantity_events
    ADD CONSTRAINT fk_inventory_quantity_events_rootid_inventory_items FOREIGN KEY (root_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: layout_markers fk_layout_markers_assetid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layout_markers
    ADD CONSTRAINT fk_layout_markers_assetid_assets FOREIGN KEY (assetid) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: project_assets fk_project_assets_assetid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_assets
    ADD CONSTRAINT fk_project_assets_assetid_assets FOREIGN KEY (assetid) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: project_assets fk_project_assets_projectid_projects; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_assets
    ADD CONSTRAINT fk_project_assets_projectid_projects FOREIGN KEY (projectid) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_history fk_project_history_projectid_projects; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_history
    ADD CONSTRAINT fk_project_history_projectid_projects FOREIGN KEY (projectid) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_order_items fk_project_order_items_assetid_assets; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_order_items
    ADD CONSTRAINT fk_project_order_items_assetid_assets FOREIGN KEY (assetid) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: project_order_items fk_project_order_items_orderid_project_orders; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_order_items
    ADD CONSTRAINT fk_project_order_items_orderid_project_orders FOREIGN KEY (orderid) REFERENCES public.project_orders(id) ON DELETE CASCADE;


--
-- Name: project_orders fk_project_orders_projectid_projects; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_orders
    ADD CONSTRAINT fk_project_orders_projectid_projects FOREIGN KEY (projectid) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: temporary_assets fk_temporary_assets_linked_po_item_id_project_order_items; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.temporary_assets
    ADD CONSTRAINT fk_temporary_assets_linked_po_item_id_project_order_items FOREIGN KEY (linked_po_item_id) REFERENCES public.project_order_items(id) ON DELETE SET NULL;


--
-- Name: temporary_assets fk_temporary_assets_projectid_projects; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.temporary_assets
    ADD CONSTRAINT fk_temporary_assets_projectid_projects FOREIGN KEY (projectid) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: users fk_users_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: users fk_users_project_id_projects; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_project_id_projects FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: users fk_users_role_roles; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_role_roles FOREIGN KEY (role) REFERENCES public.roles(name);


--
-- Name: inventory_quantity_event_lines inventory_quantity_event_lines_event_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_quantity_event_lines
    ADD CONSTRAINT inventory_quantity_event_lines_event_id_foreign FOREIGN KEY (event_id) REFERENCES public.inventory_quantity_events(id) ON DELETE CASCADE;


--
-- Name: layout_markers layout_markers_layoutid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layout_markers
    ADD CONSTRAINT layout_markers_layoutid_foreign FOREIGN KEY (layoutid) REFERENCES public.layouts(id) ON DELETE CASCADE;


--
-- Name: quantity_event_lines quantity_event_lines_event_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quantity_event_lines
    ADD CONSTRAINT quantity_event_lines_event_id_foreign FOREIGN KEY (event_id) REFERENCES public.quantity_events(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_key_foreign; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_key_foreign FOREIGN KEY (permission_key) REFERENCES public.permissions(key) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_name_foreign; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_name_foreign FOREIGN KEY (role_name) REFERENCES public.roles(name) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict vJo1a1CpX5uagwNTCarfAdrD3c2p0isnjh7qUTWcg7ceO1Dk2ziz9ClDcfLs0JP

