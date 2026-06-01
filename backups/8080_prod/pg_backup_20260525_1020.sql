--
-- PostgreSQL database dump
--

\restrict XFI5T1taXGgZCJaVCQPzLwhvVENHlfnwfQto7S0F1Q0UrbtA7jhNECeCPxVKRDn

-- Dumped from database version 15.17
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
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS '';


SET default_tablespace = '';

SET default_table_access_method = heap;

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
    client_label character varying(50)
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
    id integer NOT NULL,
    user_id character varying(255) NOT NULL,
    token_hash text NOT NULL,
    expires_at character varying(255) NOT NULL,
    created_at character varying(255) NOT NULL
);


ALTER TABLE public.auth_tokens OWNER TO postgres;

--
-- Name: auth_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.auth_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.auth_tokens_id_seq OWNER TO postgres;

--
-- Name: auth_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.auth_tokens_id_seq OWNED BY public.auth_tokens.id;


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
    created_at character varying(255)
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
    itemname character varying(255),
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
-- Name: password_resets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.password_resets (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    token_hash text NOT NULL,
    expires_at character varying(255) NOT NULL,
    created_at character varying(255) NOT NULL
);


ALTER TABLE public.password_resets OWNER TO postgres;

--
-- Name: password_resets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.password_resets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.password_resets_id_seq OWNER TO postgres;

--
-- Name: password_resets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.password_resets_id_seq OWNED BY public.password_resets.id;


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
    initials character varying(10)
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
-- Name: asset_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_history ALTER COLUMN id SET DEFAULT nextval('public.asset_history_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: auth_tokens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_tokens ALTER COLUMN id SET DEFAULT nextval('public.auth_tokens_id_seq'::regclass);


--
-- Name: company_templates id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_templates ALTER COLUMN id SET DEFAULT nextval('public.company_templates_id_seq'::regclass);


--
-- Name: dc_item_mappings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_item_mappings ALTER COLUMN id SET DEFAULT nextval('public.dc_item_mappings_id_seq'::regclass);


--
-- Name: knex_migrations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knex_migrations ALTER COLUMN id SET DEFAULT nextval('public.knex_migrations_id_seq'::regclass);


--
-- Name: knex_migrations_lock index; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knex_migrations_lock ALTER COLUMN index SET DEFAULT nextval('public.knex_migrations_lock_index_seq'::regclass);


--
-- Name: password_resets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_resets ALTER COLUMN id SET DEFAULT nextval('public.password_resets_id_seq'::regclass);


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
-- Data for Name: asset_hierarchy; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_hierarchy (id, parentid, assetid, "position") FROM stdin;
AH_81f507zo1	Laptop	\N	\N
AH_vjs3sltpc	Laptops	\N	\N
AH_js7nxfvgq	Laptops	\N	\N
AH_19dwmc8a4	Laptops	\N	\N
AH_orsw7plup	Bottle	\N	\N
AH_7h0scisnp	Laptops	\N	\N
AH_437jhyvpr	Camera	\N	\N
AH_gfz6kz09f	Laptop	\N	\N
AH_2aq0m2o1c	Laptop	\N	\N
AH_ggi4aje0o	Laptop	\N	\N
AH_n32yrn50m	Cinema Lens	\N	\N
AH_vkvln8g2r	Laptop	\N	\N
AH_51m4yaeud	Keyboard	\N	\N
AH_8prqn9n0m	Cinema Lens	\N	\N
AH_dtevkw0qd	Keyboard	\N	\N
AH_h2ukrtwbc	Desktops	\N	\N
AH_mzpr1ehgr	Audio Equipments	\N	\N
AH_ywjajh2tu	Audio Equipments	\N	\N
AH_rzftxbbow	Audio Equipments	\N	\N
AH_ite7pohzx	Audio Equipments	\N	\N
AH_awek784r8	Audio Equipments	\N	\N
AH_suckdzh0j	Audio Equipments	\N	\N
AH_uzct7wx9q	Audio Equipments	\N	\N
AH_oengap9j1	Audio Equipments	\N	\N
AH_9uv1r7xdf	Audio Equipments	\N	\N
AH_gqrczrvlb	Audio Equipments	\N	\N
AH_jwym5evtc	Audio Equipments	\N	\N
AH_iyoc6mmv4	Audio Equipments	\N	\N
AH_74v3wsifl	Audio Equipments	\N	\N
AH_rbe558nf6	Audio Equipments	\N	\N
AH_ftkpgq64n	Audio Equipments	\N	\N
AH_lv6yw900w	Audio Equipments	\N	\N
AH_whamegy3c	Audio Equipments	\N	\N
AH_oxvxfd5u6	Camera	\N	\N
AH_3p7zsmt2v	Laptop	\N	\N
\.


--
-- Data for Name: asset_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_history (id, assetid, action, oldvalue, newvalue, "user", "timestamp", details) FROM stdin;
1	MON-LOC-0426-GC8K8Z-Y	PROJECT_CHANGE	General Stock	Project: Dneg	web	2026-04-18 04:15:10.458+00	Assigned to project manually
2	MON-LOC-0426-GC8K8Z-Y	STATUS_CHANGE	In Store	In-Use	web	2026-04-18 04:15:10.489+00	Status updated via project assignment
3	ACC-MUM-0426-1560D6-N	SPLIT_CHILD_CREATED	\N	SN1	web	2026-04-18 04:47:31.172+00	Created from parent ACC-MUM-0426-B8FU04-B
4	ACC-MUM-0426-B8FU04-B	SPLIT_PARENT_UPDATED	SN1, SN2, SN3	SN2, SN3	web	2026-04-18 04:47:31.214+00	Split 1 units
5	ACC-MUM-0426-AY2ETP-B	SPLIT_CHILD_CREATED	\N	SN2	web	2026-04-18 04:47:41.408+00	Created from parent ACC-MUM-0426-B8FU04-B
6	ACC-MUM-0426-B8FU04-B	SPLIT_PARENT_UPDATED	SN2, SN3	SN3	web	2026-04-18 04:47:41.417+00	Split 1 units
7	ACC-MUM-0426-M6PTWY-D	SPLIT_CHILD_CREATED	\N	SN3	web	2026-04-18 04:49:53.139+00	Created from parent ACC-MUM-0426-B8FU04-B
8	ACC-MUM-0426-B8FU04-B	SPLIT_PARENT_UPDATED	SN3		web	2026-04-18 04:49:53.154+00	Split 1 units
9	ACC-MUM-0426-AY2ETP-B	PROJECT_CHANGE	General Stock	Project: Dneg	web	2026-04-18 05:00:50.643+00	Assigned to project manually
10	ACC-MUM-0426-AY2ETP-B	STATUS_CHANGE	In Store	In-Use	web	2026-04-18 05:00:50.673+00	Status updated via project assignment
11	ACC-MUM-0426-1560D6-N	PROJECT_CHANGE	General Stock	Project: Dneg	web	2026-04-18 06:39:36.065+00	Assigned to project manually
12	ACC-MUM-0426-1560D6-N	STATUS_CHANGE	In Store	In-Use	web	2026-04-18 06:39:36.086+00	Status updated via project assignment
13	ACC-MUM-0426-B8FU04-B	UNSPLIT_MERGED	SN3	SN3	web	2026-04-18 06:39:59.424+00	Merged 1 children back
14	ACC-MUM-0426-B8FU04-B	UNSPLIT_MERGED	SN2	SN3, SN2	web	2026-04-18 06:40:16.765+00	Merged 1 children back
15	ACC-MUM-0426-B8FU04-B	UNSPLIT_MERGED	SN1	SN3, SN2, SN1	web	2026-04-18 06:40:38.05+00	Merged 1 children back
16	ACC-MUM-0426-6TJON3-7	SPLIT_CHILD_CREATED	\N	SN3	web	2026-04-18 12:15:05.328+00	Created from parent ACC-MUM-0426-B8FU04-B
17	ACC-MUM-0426-B8FU04-B	SPLIT_PARENT_UPDATED	SN3, SN2, SN1	SN2, SN1	web	2026-04-18 12:15:05.466+00	Split 1 units
18	ACC-MUM-0426-B8FU04-B	UNSPLIT_MERGED	SN3	SN2, SN1, SN3	web	2026-04-18 12:15:11.406+00	Merged 1 children back
19	ACC-MUM-0426-WVLA8Z-N	SPLIT_CHILD_CREATED	\N	SN2	web	2026-04-18 12:15:26.573+00	Created from parent ACC-MUM-0426-B8FU04-B
20	ACC-MUM-0426-OMRMVJ-B	SPLIT_CHILD_CREATED	\N	SN1	web	2026-04-18 12:15:26.583+00	Created from parent ACC-MUM-0426-B8FU04-B
21	ACC-MUM-0426-B8FU04-B	SPLIT_PARENT_UPDATED	SN2, SN1, SN3	SN3	web	2026-04-18 12:15:26.596+00	Split 2 units
22	ACC-MUM-0426-B8FU04-B	UNSPLIT_MERGED	SN2	SN3, SN2	web	2026-04-18 12:15:40.182+00	Merged 1 children back
24	DAT-MUM-0426-1DCDQ6-3	ASSIGNMENT_CHANGE	None	Arnav Thatte	admin	2026-04-20 07:41:18.391+00	Personnel updated
23	DAT-MUM-0426-1DCDQ6-3	STATUS_CHANGE	None	Demo	admin	2026-04-20 07:41:18.391+00	Status updated
25	DAT-MUM-0426-1DCDQ6-3	LOCATION_CHANGE	None	Mumbai	admin	2026-04-20 07:41:18.391+00	Location updated
26	DAT-MUM-0426-1DCDQ6-3	STATUS_CHANGE	None	Demo	admin	2026-04-20 08:20:26.549+00	Status updated
27	DAT-MUM-0426-1DCDQ6-3	ASSIGNMENT_CHANGE	None	Arnav Thatte	admin	2026-04-20 08:20:26.549+00	Personnel updated
28	DAT-MUM-0426-1DCDQ6-3	LOCATION_CHANGE	None	Mumbai	admin	2026-04-20 08:20:26.549+00	Location updated
29	DAT-MUM-0426-1DCDQ6-3	ASSIGNMENT_CHANGE	None	Arnav Thatte	admin	2026-04-20 08:31:25.96+00	Personnel updated
30	DAT-MUM-0426-1DCDQ6-3	STATUS_CHANGE	None	Demo	admin	2026-04-20 08:31:25.96+00	Status updated
31	DAT-MUM-0426-1DCDQ6-3	LOCATION_CHANGE	None	Mumbai	admin	2026-04-20 08:31:25.96+00	Location updated
32	ACC-MUM-0426-B8FU04-B	STATUS_CHANGE	None	Demo	admin	2026-04-22 11:19:36.679+00	Status updated
33	ACC-MUM-0426-OMRMVJ-B	STATUS_CHANGE	None	In-Use	admin	2026-04-23 04:26:12.502+00	Status updated
34	ACC-MUM-0426-OMRMVJ-B	LOCATION_CHANGE	None	Mumbai	admin	2026-04-23 04:26:12.503+00	Location updated
35	PRT-MUM-0526-RHAOIO-D	CREATE	\N	Owned	admin	2026-05-02 09:18:28.117+00	Initial assignment to: None
36	PRT-MUM-0526-RHAOIO-D	PROJECT_CHANGE	General Stock	Project: Sample	web	2026-05-02 09:21:32.439+00	Assigned to project manually
37	PRT-MUM-0526-RHAOIO-D	STATUS_CHANGE	In Store	In-Use	web	2026-05-02 09:21:32.444+00	Status updated via project assignment
38	PRT-MUM-0526-RHAOIO-D	PROJECT_CHANGE	General Stock	Project: Sample	web	2026-05-02 09:22:21.471+00	Assigned to project manually
39	PRT-MUM-0526-RHAOIO-D	STATUS_CHANGE	In Store	In-Use	web	2026-05-02 09:22:21.476+00	Status updated via project assignment
40	PRT-MUM-0526-RHAOIO-D	PROJECT_CHANGE	General Stock	Project: Sample	web	2026-05-02 10:02:42.883+00	Assigned to project manually
41	PRT-MUM-0526-RHAOIO-D	STATUS_CHANGE	In Store	In-Use	web	2026-05-02 10:02:42.886+00	Status updated via project assignment
42	ACC-MUM-0426-OMRMVJ-B	PROJECT_CHANGE	General Stock	Project: Dneg	admin	2026-05-02 12:03:44.093+00	Assigned via Delivery Challan 26/0019
43	SRV-MUM-0426-FC88BN-6	PROJECT_CHANGE	General Stock	Project: Dneg	admin	2026-05-02 12:03:44.098+00	Assigned via Delivery Challan 26/0019
\.


--
-- Data for Name: asset_it_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_it_details (assetid, macaddress, ipaddress, networktype, physicalport, vlan, socketid, userid) FROM stdin;
MON-LOC-0426-GC8K8Z-Y			DHCP				
MON-LOC-0426-RZQZ0T-C			DHCP				
LPT-MUM-0326-E6UDXT-Z			DHCP				
AST002			DHCP				
ACC-MUM-0426-B8FU04-B			DHCP				
SRV-MUM-0426-FC88BN-6			DHCP				
ACC-MUM-0426-TVSU8B-8			DHCP				
DAT-MUM-0426-1DCDQ6-3			DHCP				
ACC-MUM-0426-OMRMVJ-B			DHCP				
PRT-MUM-0526-RHAOIO-D		det:9bd8559a94cd17f8cdfdaee6a2db093b	DHCP				HpAdmin / hp@Cineom
\.


--
-- Data for Name: asset_kinds; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_kinds (name, module, icon, parentname, lastupdated, displayimage, identifier, is_deleted, deleted_at) FROM stdin;
Laptop	IT	/static/icons/laptop.svg	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Gaming Laptop	IT	/static/icons/laptop.svg	\N	2026-05-04T05:16:28.749Z	\N	GML	1	2026-05-04T09:19:51.450Z
Desktop	IT	/static/icons/desktop.svg	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Monitor	IT	/static/icons/monitor.svg	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Server	IT	/static/icons/server.svg	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Switch	IT	/static/icons/switch.svg	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Camera	IT	/static/icons/camera.svg	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
License	IT	🔑	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Router	IT	📶	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Printer	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
NVR	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Phone	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Tablet	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Projector	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Scanner	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
UPS	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Rack	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Software	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Furniture	NON_IT	📦	Non-IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Vehicle	NON_IT	📦	Non-IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Machinery	NON_IT	📦	Non-IT Assets	2026-03-16T12:15:21.516Z	\N	\N	0	\N
Data Drives	IT	📦	\N	2026-04-01T08:45:08.268Z	\N	DDR	0	\N
Access Point	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	1	2026-05-04T09:19:56.618Z
Accessory	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	1	2026-05-04T09:20:00.131Z
Cable	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	1	2026-05-04T09:20:02.460Z
Firewall	IT	📦	IT Assets	2026-03-16T12:15:21.516Z	\N	\N	1	2026-05-04T09:20:06.490Z
Cables	IT	📦	\N	2026-05-04T09:25:52.213Z	\N	CBL	0	\N
\.


--
-- Data for Name: assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.assets (id, no, itemname, itemdescription, status, make, model, srno, serialno, type, category, icon, isplaceholder, parentid, currentlocation, previouslocation, dispatchreceivedt, purchasedetails, remarks, purpose, purchasedate, lastupdated, qrcode, assignedto, macaddress, ipaddress, networktype, physicalport, vlan, socketid, userid, noqr, currency, asset_value, warranty_months, amc_months, quantity_parent_id, quantity_root_id, quantity_unit, quantity_total, quantity_available, quantity_precision, quantity_updated_at, conversion_unit, conversion_factor, conversion_mode, is_quantity_tracked, warranty_tracking, boughtagainstpo, sentagainstdc, is_batch, linked_po_item_id, is_deleted, deleted_at, department, client_label) FROM stdin;
AST003	\N	Logitech Mouse	\N	In-Use	\N	M185	SN1003	\N	Mouse	IT	\N	0	\N	MUMBAI	\N	\N	\N	Test Asset 3	\N	\N	2026-03-17T05:23:45.545Z	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	USD	0	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	0	\N	0	\N	\N	\N
DAT-MUM-0426-1DCDQ6-3	\N	Broadstream Pendrive 8GB	\N	Demo	Broadstream	8GB Pendrive	det:a48ba89457fae480ec9171a4c718fa5e	\N	Data Drives	IT		0		Mumbai	\N				\N		2026-04-20T08:31:25.851Z	data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAAAklEQVR4AewaftIAAA16SURBVO3BgY0cWmwkwCax+afcpwR8Xw/wwKNlVU3/CABwygYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcnv8TMhM9pmxczk6va5sXM5Kq2eTEz+UZt821mJnxO2/zrNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcnh7XNRTOTT2ubVzOTT2ubb9M2r2YmL9rm1czkRdu8mpn8BjOTT2ubT2ubi2YmF20AgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4Jyf8NdmJt+obS5qm280M3nRNt+obT6tbb7NzORV27yYmfwGM5Nv1Db8tw0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM75CXzAzOQbzUw+rW1ezExetc2nzUw+rW1ezEw+rW0+rW3g/9oGADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM75CfC/ambC35mZfFrbfJuZyau2gf9NGwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnPMT/lrb8Dltw2fMTH6DtuF7tA3/rg0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnPOTw2Ym/LtmJq/a5sXM5FXbvJiZfKO2eTEzedU2L2Ymr9rmxczkVdv8BjMT7tgAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCc6R+B/2Uzk2/UNp82M+HvtM1vMDN50Tbwf20DAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdM/8gvMDN51TbfZmbyqm1ezEy+Udu8mJn8Bm3zaTOTV23zYmbyjdrmxczkVdu8mJnwd9rm02Ymr9rmX7cBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5P/kl2oa/0zavZiYv2ubT2ubVzORF27yamXzazORF23yjtnkxM/lGM5MXbfONZibfZmbyqm1etM1FGwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4Z/pH+JiZyYu2eTUzuahtXs1MPq1tfoOZyYu2eTUz4Xu0zafNTF60zauZyYu2uWgDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzfvJLzExetc2LmcmrtnkxM3nVNr/BzOTFzORV27yYmXzazOTT2ubTZiav2ubFzOTT2ubVzORF23zazOTTZiav2obvsAEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAc6Z/5KiZybdpm0+bmbxqm28zM3nVNi9mJt+obb7NzOQbtc23mZl8Wtt8o5nJi7b5tJnJq7b5120AgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOT36Jmcmntc2rmcm3aZtXM5NPa5sXbfON2ubbzEw+rW1ezUxetM2rmcmntc2ntc2Lmcmrtvm0tnkxM3nVNi/a5qINAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJzzE/7azOTTZibfqG1ezExezUy+Tdu8mpm8aJtv1Db8nZnJt2mbVzOTF23zjWYmL9rmog0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM75yWFtw9+ZmXxa27yYmbxqm09rm2/TNp82M/m0mcmrtvk2M5NPm5m8aptPm5l8Wtvw3zYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM5Pfom2eTUz+TZt82pm8mlt82Jm8o1mJp/WNi9mJp/WNt+obb7NzORV27xom1czk28zM/lGM5MXbXPRBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA50z/yFEzkxdt82kzk1dt82kzk9+gbfg7M5MXbfNqZvJt2ubTZiZ8Ttvw3zYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM5PDmubFzOT32Bm8hu0zafNTF61zafNTF60zau2eTEzedU2L2Ymr9rmN2ib32Bm8qJtXs1MXrTNRRsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJzzk8NmJi/a5tXM5Nu0zW8wM/kNZiafNjN51TYv2uY3mJl8Wtu8mpm8aJtv1DZ8hw0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnPOTw9rm09rmxczk02Ymr9rm27TNq5nJp81MPq1tXsxMfoO2+UZt82Jm8qptXsxMXrXNi5nJp7UNn7EBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA50z/yC8xMXrXNi5nJq7b5tJnJi7bhc2YmL9rmG81MLmqbVzOTF23zambybdrmG81MXrTNRRsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGf6R/grM5NPa5tPm5m8apsXM5NXbfNiZvKqbb7NzOTT2uY3mJm8apvfYGbyom1ezUxetM2rmcm3aZuLNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcnfFTbvJiZfFrbXDUz+bS2+TYzk1dt82Jm8qptXrTNq5nJt2mbV23zYmbyaTOTb9Q2/LcNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJzzk19iZvJpbfMbzEw+rW0+rW2uapvfYGbyaW3zaTOTFzOTq9rmxczk02Ymr9rmX7cBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5P/kl2uY3aJvfYGbyqm1ezEy+Udu8aJtXM5MXbfNpbfNpM5Or2ubbzEy+0czkRdtctAEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAc37yS8xM+Jy2+bSZyYu2eTUz+Q3a5tNmJi/a5tPa5tXM5NPa5sXM5NNmJq/a5tNmJi/a5tXM5MXM5FXb/Os2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA45yeHtc1FM5NPa5tXM5MXM5NXbfNiZvJpM5NXbfNiZvJpM5NXbfNt2ubVzOTbtA38/2wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4Jyf8NdmJt+obb7NzOQbzUy+Tdu8mpm8aJtPm5l82szkVdv8BjOT36BtPq1t+G8bAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCc8xP4gLZ5NTN50TafNjP5Rm3zYmbyaW3zambyom1ezUy+Tdt82szkVdu8mJl8o5nJp7XNv24DAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOf8BPgftc1VbcPfaZsXM5NPa5tXM5MXbfNpM5NXbcN/2wAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JzpH/kFZiav2uaimcmrtvm0mcmntc2Lmcmntc03mplc1DbfaGbyG7QN32EDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOf85LCZCZ8xM3nVNp82M3nRNt9oZvKibb5R27yYmXzazORV2/wGbXPRzORV2/zrNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGf6RwCAUzYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAc/4fSeoH/nika8MAAAAASUVORK5CYII=	Arnav Thatte	\N	\N	\N	\N	\N	\N	\N	0	INR	1000	0	0	\N	\N	\N	0	0	0	\N		\N	multiply	0	\N	\N	\N	0	\N	0	\N	\N	\N
ACC-MUM-0426-B8FU04-B	\N		\N	Demo				\N				0	\N		\N				\N	\N	2026-04-22T11:19:36.601Z	data:image/png;base64,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		\N	\N	\N	\N	\N	\N	\N	0	INR	5000	6	0	\N	ACC-MUM-0426-B8FU04-B	pcs	3	3	0	2026-04-18T12:15:40.179Z	\N	\N	multiply	1	\N	I8-19870659	26/0003	1	\N	0	\N	\N	\N
SRV-MUM-0426-FC88BN-6	\N	dell pe r660xs	\N	In-Use	Dell	R660XS	det:299b302d78bedbdfdb181d9f3ea43dab	\N	Server	IT		0	\N	On Site	\N		Dneg		\N	2026-04-14	2026-04-15T11:40:18.793Z	data:image/png;base64,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	Project: Dneg	\N	\N	\N	\N	\N	\N	\N	0	INR	796500	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	multiply	0	\N	PO89765	26/0019	0	26	1	2026-05-02T09:14:21.749Z	\N	SRV-D-FC88BN
ACC-MUM-0426-TVSU8B-8	\N	BAKON Iron Air Gun GS4000	\N	In-Use	Bakon	GS4000		\N	Accessory	IT		0	\N	Mumbai	\N	2026-04-08	For Naidu Sir		\N	2026-04-08	2026-04-15T12:01:44.522Z	data:image/png;base64,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	Arnav Thatte	\N	\N	\N	\N	\N	\N	\N	0	INR	0	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	multiply	0	\N	\N	\N	0	\N	1	2026-05-02T09:13:28.177Z	\N	\N
MON-LOC-0426-RZQZ0T-C	\N	Atomos 7	\N	In-Use	Atomos	Atomos 7" Shogun Ultra	O4A9SHOU50H34	\N	Monitor	IT		0	\N	On Site	\N		Purchased via PO: I8-19870659 from  on 2025-08-12	PO Item conversion. Original Qty: 1 EACH	\N	2025-08-12	2026-04-03T09:25:08.796Z	data:image/png;base64,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	Project: Amazon Hyderabad 	\N	\N	\N	\N	\N	\N	\N	0	INR	98730	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	multiply	0	\N	\N	\N	0	6	1	2026-05-02T09:13:47.755Z	\N	MON-AH-RZQZ0T
MON-LOC-0426-GC8K8Z-Y	\N	Atomos Shogun Ultra	\N	In Store	Atomos	Atomos 7" Shogun Ultra Monitor-Recorder	S/N - O4A9SHOU50H34	\N	Monitor	IT		0	\N	Warehouse	\N				\N		2026-04-03T08:25:29.524Z	data:image/png;base64,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	\N	\N	\N	\N	\N	\N	\N	\N	0	INR	0	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	multiply	0	\N	\N	\N	0	\N	1	2026-05-02T09:14:04.523Z	\N	\N
CAB-MUM-0526-FDLUHM-A	\N	Cisco STACK-T1-1M Stacking Cable	\N	Sold	Cisco	STACK-T1	det:9525c2e61e827621af7d6faf8a5afc7425f453869db5d8ea00d59db373a24be6	\N	Cables	IT		0	\N	Mumbai	\N		Purchased For JioStar 		\N	2026-04-30	2026-05-04T09:31:16.318Z	data:image/png;base64,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		\N	\N	\N	\N	\N	\N	\N	0	USD	0	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	multiply	1	0	\N	\N	1	\N	0	\N	\N	CAB-MUM-FDLUHM
LPT-ON-0326-5JUHYK-6	\N	Sample	\N	Project	Sample		SMPLP	\N	Laptop	IT		0	LPT-MUM-0326-E6UDXT-Z	On Site	\N	2026-03-17			\N	2026-03-12	2026-03-24T04:50:46.093Z	data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAAAklEQVR4AewaftIAAA3ESURBVO3BgQ1lV64ksJLQ+adcOxnYB/gX+9wiOf2fAACnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAc/7kLzEz4Ttt82Jm8rW2eTUz+Ru0zYuZyS9qmxczk6+1zauZyYu2+drMhO+0zX/dBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA5/zJYW1z0czkF7UNv6NtXsxMXs1MvtY2v2Zm8qptvtY2F81MLtoAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDl/wr82M/lFbfM3mJm8aJtXbfO1mcnXZiYv2uZrbfNqZvKibV7NTF60zdfa5m8wM/lFbcM/2wAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4Jw/gQ+0zauZyddmJl9rmxczk6/NTF61zYuZyau2eTEzedU2L2YmX5uZvGob+L+0AQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBz/gQ+MDP52szka23ztbZ5NTP5NW3ztbZ5NTP5NW0D/79tAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzp/wr7UN/07bvJqZ/JqZyau2eTEz+RvMTL7WNq/a5sXM5FXbvJiZvGqbX9M2/HdtAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcPzlsZsI3Ziav2ubFzORV27yYmfyitnkxM/lFbfNiZvKqbfh3ZibcsQEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDnT/wn8gJnJi7b5G8xMflHb/A1mJr+mbeD/tw0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnPMnf4mZyau2+drMhN8xM3nRNq9mJi/a5m8wM3nVNr+mbV7NTF7MTL7WNl+bmbxqmxczk1/UNv91GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnPMnf4m2+UVt82Jm8rW2eTUz+TUzk1dt82Jm8rWZydfa5tXM5Gszk4va5tXM5Gszkxdt82pmwm/YAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5f3LYzORF2/wNZiav2uZrM5OvzUx+Tdu8mpm8mJm8apuvzUxetM3XZiZXtc2LmcnfoG0u2gAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4Jw/+UvMTH7RzORrbfNrZiav2ubXzEx+Udv8mpnJq7Z5MTP5G8xMftHM5Gtt82Jm8qpt+GcbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADjnT/4SbfO1mcnX2uZrM5Ovtc2rmcmLtrlqZvKibV7NTF60zauZyYu2eTUzedE2r2YmX2ubFzOTV23zYmbytbZ5NTP5Wtv8120AgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOn/wlZiav2uZrbfNiZvK1tnk1M/k1M5NXbfNrZiav2ubXzEy+NjP5RW3zYmbyi2Ymv2Zm8qpt+GcbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADjnT/4SbfNqZvKibb7WNl+bmbxqm6+1zYuZyS9qm6/NTF60Df/OzORV23xtZvKibV7NTLhjAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAc/7kLzEzedU2L2Ymr9rmazOTF23zambytbZ50TavZiYv2ubVzORF27xqmxczk6+1zddmJl9rm1/UNnxjZvKqbf7rNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzvR/ctTM5Gtt87WZyd+gbb42M/la23xtZvKibV7NTL7WNl+bmXytbX7NzOSqtuGfbQCAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM70f/IXmJl8rW1ezUxetM2rmcmLtvnazORrbfNqZvKibf4GM5Ovtc3fYGbyi9rmazOTF23ztZnJL2qb/7oNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJzzJ5wzM/la27yamXytbV7MTL7WNq9mJi/a5tXM5MXM5Gtt82pm8rW2+drM5EXbvGqbr81Mfk3bXLQBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5f/KXaJtf1DZfa5uvzUz+BjOTr7XNi5nJq7b5Wtt8bWbytbZ5MTP52szkazOTq9rmxczkVdv8120AgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4Jw/4V+bmbxqmxczk1/UNi9mJq/a5sXM5Gtt82pm8rWZydfa5sXM5FXbfG1m8mva5mszk1dt87WZyYu2eTUz4Z9tAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzp/8JWYmX2ubr7XNq5nJi7bhd7TNL5qZvGibv0HbfG1m8rW2eTUz+VrbvJiZvGob/tkGADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM75k8Pa5sXM5FXbvJiZfG1m8qptLpqZfG1m8qptvtY2L2Ymv6htXsxMvtY2r2YmL2YmV81MvtY2/3UbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCc8yf8a23zambyom1ezUxetM2rmcmLtvla2/yimcmLtnk1M3nRNl9rm1czE/6dtnkxM/la27yambxoG76xAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzpv+Tv8DM5Be1za+ZmXytbV7NTH5N27yamXytbV7MTH5R27yYmfyitnkxM+E7bfNiZvKqbf7rNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGf6P4H/YzOTV23za2Ymf4O2eTUzedE2X5uZfK1tXs1MvtY2v2Zm8qptXsxMvtY2F20AgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4Jw/+UvMTPhO23xtZvK1tnnRNnxnZvKibfh3Ziav2uZv0DYvZiav2ua/bgMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHP+5LC2uWhm8ova5mszkxdt87WZyd9gZvKqbV7MTH5R27yYmXytbfh32uaiDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCc8yf8azOTX9Q2fGNm8qptvtY2L2YmX2ubVzOTF23zambyN5iZ/A1mJi/a5mszk1dt81+3AQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAOX8CP2Jm8qJtXrXNi5nJq5nJi7b5RW3zYmbyqm0uaptXM5MXbfM3mJm8apsXbXPRBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO+RP4QNtc1TYvZiZfa5tfNDN50TZXtc2LmcnX2ubVzORF27yamXytbf7rNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOdP+Nfahu/MTL7WNi/a5mtt8zdom1czkxczk1dt82Jm8otmJi/a5he1zYuZCd/YAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5f3LYzIRvzEx+0czka23ztZnJRW3ztbb5RW3zYmbyi9rma23DP9sAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCc6f8EADhlAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADjn/wGW5h0lQTi5QwAAAABJRU5ErkJggg==	PROJECT:PRJ1773746860453	\N	\N	\N	\N	\N	\N	\N	0	INR	30000	12	0	\N	\N	\N	\N	\N	\N	\N		\N	multiply	0	\N	\N	26/0018	0	\N	1	2026-05-02T09:14:35.226Z	\N	LPT-S-5JUHYK
PRT-MUM-0526-RHAOIO-D	\N	HP Laserjet Printer	\N	In-Use	HP	LaserJet 15T	det:008f1878c20ffe74ebdb04e7f057e90d	\N	Printer	IT	???????	0	\N	On Site	\N	2026-05-01			\N	2026-04-24	2026-05-02T09:18:28.112Z	data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAAAklEQVR4AewaftIAAAwTSURBVO3BUW4YC2wEsJHg+195ml+jD2i9MDaORXL6RwCAUzYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA53zkl5uZ8He1zVtmJk+0zZtmJj9d2zwxM3lT27xpZvJVbfPEzIS/q21+qw0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnfIT/1DZ8NjP56drmiZnJm9rmp5uZvKlt3jQzeaJtfrq24bOZCZ9tAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcjfKuZyU/XNv+CmclXtc2b2uZNM5O3tM2bZiZvapsnZiZf1Tb/gpnJT9c2fI8NAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO+Qjw2MzkX9A2XzUzeVPbvGlmApdtAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcj8IvMTJ5omydmJm9qm5+ubZ6YmTzRNk+0zRMzE/gNNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJzzEb5V2/D3tM0TM5Mn2uaJmclP1zZPzEyeaJsnZiZPtM0TbfNbtQ13bACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADjnI/ynmQn8FjOTr2ob/reZyVe1zZtmJvB/2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDO9I/ADzQz4bO2ecvM5Im2AX6+DQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdM/8gvNjN5om2emJnwWdvw2cyEz9rmTTOTt7TNEzMTPmsbvscGADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnTP8I/8vM5Im24XvMTL6qbd40M3lT2zwxM/mqtnliZvKmtnnTzOSna5snZiZPtM1PNzN5om1+qw0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnfIRvNTP5qrZ5YmbCv6ltnpiZvGVm8kTb8D3a5omZCZ+1DZ9tAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcjv9zM5E1t81u1zRMzk9+qbZ6Ymbypbb5qZvLEzOSJtvkXtM1XzUze1Da/1czkibbhsw0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnfOSXa5s3zUze0jZPzEyemJm8qW2+ambyprZ5U9vw2czkibZ5S9u8aWbyprZ5YmbyVW3D99gAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzkd+uZnJE23zW7XNm2YmfNY2T8xMfquZCd+jbf4FbfOWmckTbfNbbQCAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADjnI/ynmckTbfPTzUze1DZvaZs3zUyeaJs3tc1vNTN508zkq9rmTTOTN7XNT9c2fLYBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5H+E/tc0TM5Ofrm3+BTOTr2qbJ2Ym/4K2ecvM5E1t81vNTJ5omyfa5omZyZtmJm9pGz7bAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM70j/xiM5M3tc1vNTN5om3eMjN5om2emJm8qW1+upnJb9Y2P93M5Im2eWJm8kTb8PdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcj8P/UNk/MTJ5om69qm39B27xpZvKWtnliZvJbzUyeaJsn2uZfMDP5qrZ5YmbyRNv8VhsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO+Qj/qW2emJnwWds8MTP5qrZ5YmbyRNs8MTP56drmiZnJE23zppnJbzUzeaJtfqu24bMNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA53yEf1bbPDEzeaJtfrqZyRNt88TM5Im2edPM5C1t88TM5Im2eaJt3tI2T8xM3jQz+elmJk+0DZ9tAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcjfKu2ecvM5Im2eWJm8qa2ecvM5Im2eWJm8kTb8D1mJnyPtnliZvKWmckTbfNbbQCAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM70j8APNDP5qrZ508zkTW3zW81M3tQ2T8xMvqpt/gUzkze1zVfNTN7UNr/VBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHOmf+QXm5nwd7XNW2YmT7TNm2Ymb2qbt8xM+KxtnpiZPNE2T8xMfrq24XtsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcj/Ke24bOZyZtmJl/VNk/MTN7UNr9V27xpZvJbtQ2fzUyeaBs+2wAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOR/hWM5Ofrm34rG3eNDN5om1+q5nJm9rmiZnJV81M+B5tw/fYAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM5HgMxMnmib32pm8qa2eWJm8sTM5Im2+elmJk+0zU83M3mibfhsAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkfAdI2b2qbJ2YmT7TNTzczeaJtfrqZyRNt85vNTPh7NgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOOcjfKu24Xu0zVfNTPgebfPEzORNM5Mn2uanm5k80TZPzEyeaJsn2uarZiZ8jw0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnTP/ILzYz4e9qmydmJl/VNm+amfBZ2zwxM3mibZ6YmTzRNm+ZmfwL2oZ/zwYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzpn8EADhlAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4Jz/AVVWRugdnkK0AAAAAElFTkSuQmCC	Project: Sample	\N	\N	\N	\N	\N	\N	\N	0	USD	0	36	36	\N	\N	\N	\N	\N	\N	\N	\N	\N	multiply	0	0	\N	\N	0	30	0	\N	\N	PRT-S-RHAOIO
ACC-MUM-0426-OMRMVJ-B	\N	sample	\N	In-Use	asda	asdasd	det:96f5084ed8c51284739c22735234e076	\N	Accessory	IT		0	ACC-MUM-0426-B8FU04-B	On Site	\N				\N		2026-04-23T04:26:12.446Z	\N	Project: Dneg	\N	\N	\N	\N	\N	\N	\N	0	INR	5000	6	0	\N	\N	\N	0	0	0	\N		\N	multiply	0	0	PO89765	26/0019	0	\N	1	2026-05-02T07:15:16.179Z	\N	ACC-D-OMRMVJ
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_log (id, action, "user", assetid, severity, details, "timestamp") FROM stdin;
1	CREATE	admin	LPT-MUM-0326-E6UDXT-Z	INFO	Asset created: Sample (Laptop)	2026-03-17T05:24:01.129Z
2	CREATE	admin	LPT-MUM-0326-E6UDXT-Z	INFO	Asset created: Sample	2026-03-17T05:24:01.339Z
3	UPDATE_PROJECT	web	PRJ1773724147996	INFO	Project updated: Location	2026-03-17T06:16:03.460Z
4	UPDATE_PROJECT	web	PRJ1773724147996	INFO	Project updated: BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode, ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode, OwnerEmail, CoordinatorEmail	2026-03-17T09:47:02.224Z
5	USER_DELETE	admin	testadmin	WARN	Deleted user testadmin	2026-03-17T09:50:26.302Z
6	UPDATE_PROJECT	web	PRJ1773748315543	INFO	Project updated: Location	2026-03-17T11:53:52.971Z
7	UPDATE	admin	LPT-MUM-0326-E6UDXT-Z	INFO	Asset updated: Sample	2026-03-23T11:40:13.114Z
8	UPDATE	admin	LPT-MUM-0326-E6UDXT-Z	INFO	Asset updated: Sample	2026-03-23T11:40:13.146Z
9	DC_CREATED	System	DC1774589052923	INFO	Created Delivery Challan 26/0001 for Sudhir Lodhi	2026-03-27T05:24:12.957Z
10	USER_CREATE	admin	User	INFO	Created user User with role user	2026-03-31T10:09:41.379Z
11	CREATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset created: Broadstream Pendrive 8GB (Data Drives)	2026-04-01T08:47:12.673Z
12	CREATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset created: Broadstream Pendrive 8GB	2026-04-01T08:47:12.683Z
13	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-01T08:48:15.658Z
14	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-01T08:48:15.672Z
15	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-01T09:04:23.631Z
16	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-01T09:04:23.642Z
17	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-01T11:11:27.317Z
18	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-01T11:11:27.328Z
19	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-02T07:43:55.738Z
20	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-02T07:43:55.748Z
21	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-02T08:14:27.731Z
22	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-02T08:14:27.746Z
23	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-02T08:14:40.618Z
24	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-02T08:14:40.634Z
25	UPDATE_PROJECT	admin	PRJ1773748315543	INFO	Project updated: Status	2026-04-02T12:04:51.520Z
26	UPDATE_PROJECT	admin	PRJ1773748315543	INFO	Project updated: Status	2026-04-02T12:04:53.161Z
27	UPDATE_PROJECT	admin	LOC-0426-222627-P	INFO	Project updated: Status	2026-04-02T12:04:54.041Z
28	CREATE	admin	MON-LOC-0426-GC8K8Z-Y	INFO	Asset created: Atomos Shogun Ultra (Monitor)	2026-04-03T08:25:29.544Z
29	CREATE	admin	MON-LOC-0426-GC8K8Z-Y	INFO	Asset created: Atomos Shogun Ultra	2026-04-03T08:25:29.561Z
30	CREATE	admin	MON-LOC-0426-RZQZ0T-C	INFO	Asset created: Atomos 7 (Monitor)	2026-04-03T09:25:08.808Z
31	CREATE	admin	MON-LOC-0426-RZQZ0T-C	INFO	Asset created: Atomos 7	2026-04-03T09:25:08.831Z
32	DELETE_DENIED	web	MON-LOC-0426-GC8K8Z-Y	WARN	Unauthorized delete attempt	2026-04-04T06:29:54.890Z
33	DELETE_DENIED	web	MON-LOC-0426-GC8K8Z-Y	WARN	Unauthorized delete attempt	2026-04-04T06:30:03.259Z
34	DELETE_DENIED	web	MON-LOC-0426-GC8K8Z-Y	WARN	Unauthorized delete attempt	2026-04-04T06:50:17.848Z
35	DELETE_DENIED	web	MON-LOC-0426-GC8K8Z-Y	WARN	Unauthorized delete attempt	2026-04-04T06:52:17.094Z
36	DELETE_DENIED	web	MON-LOC-0426-GC8K8Z-Y	WARN	Unauthorized delete attempt	2026-04-04T06:57:37.730Z
37	DELETE_DENIED	web	MON-LOC-0426-RZQZ0T-C	WARN	Unauthorized delete attempt	2026-04-04T06:59:03.375Z
38	DELETE	admin	MON-LOC-0426-GC8K8Z-Y	INFO	Asset marked for deletion (30-day grace period)	2026-04-04T07:37:29.207Z
39	UPDATE	admin	LPT-MUM-0326-E6UDXT-Z	INFO	Asset updated: Sample	2026-04-04T11:33:45.683Z
40	UPDATE	admin	LPT-MUM-0326-E6UDXT-Z	INFO	Asset updated: Sample	2026-04-04T11:33:45.696Z
41	UPDATE	admin	AST002	INFO	Asset updated: HP Monitor	2026-04-04T11:45:52.919Z
42	UPDATE_IT_DETAILS	admin	AST002	INFO	IT details updated: Network: DHCP	2026-04-04T11:45:52.945Z
43	UPDATE	admin	AST002	INFO	Asset updated: HP Monitor	2026-04-04T11:45:52.954Z
44	UPDATE	admin	AST002	INFO	Asset updated: HP Monitor	2026-04-04T11:47:38.795Z
45	UPDATE	admin	AST002	INFO	Asset updated: HP Monitor	2026-04-04T11:47:38.808Z
46	DELETE	admin	MON-MUM-0426-UASCR0-7	INFO	Asset marked for deletion (30-day grace period)	2026-04-04T11:48:35.203Z
47	DELETE	admin	MON-MUM-0426-5N61GW-Z	INFO	Asset marked for deletion (30-day grace period)	2026-04-04T11:48:46.498Z
48	DELETE	admin	MON-MUM-0426-5I5VCR-I	INFO	Asset marked for deletion (30-day grace period)	2026-04-04T11:48:59.267Z
49	DELETE	admin	AST002	INFO	Asset marked for deletion (30-day grace period)	2026-04-04T11:54:39.068Z
50	DELETE	admin	LPT-MUM-0326-E6UDXT-Z	INFO	Asset marked for deletion (30-day grace period)	2026-04-07T05:54:37.043Z
51	DELETE	admin	AST001	INFO	Asset marked for deletion (30-day grace period)	2026-04-07T05:54:53.729Z
52	CREATE	admin	ACC-MUM-0426-B8FU04-B	INFO	Asset created: sample (Accessory)	2026-04-07T08:25:40.368Z
53	CREATE	admin	ACC-MUM-0426-B8FU04-B	INFO	Asset created: sample	2026-04-07T08:25:40.402Z
54	DC_CREATED	admin	DC1775550807634	INFO	Created Delivery Challan 26/0002 for Sudhir Lodhi	2026-04-07T08:33:27.681Z
55	DC_CREATED	admin	DC1776162766645	INFO	Created Delivery Challan 26/0003 for RintoV	2026-04-14T10:32:46.692Z
56	CREATE	admin	SRV-MUM-0426-FC88BN-6	INFO	Asset created: dell pe r660xs (Server)	2026-04-15T11:40:18.809Z
57	CREATE	admin	SRV-MUM-0426-FC88BN-6	INFO	Asset created: dell pe r660xs	2026-04-15T11:40:18.828Z
58	DC_CREATED	admin	DC1776253672075	INFO	Created Delivery Challan 26/0004 for assaassaas	2026-04-15T11:47:52.106Z
59	DC_CREATED	admin	DC1776253731705	INFO	Created Delivery Challan 26/0005 for assaassaas	2026-04-15T11:48:51.735Z
60	DC_CREATED	admin	DC1776253866827	INFO	Created Delivery Challan 26/0006 for assaassaas	2026-04-15T11:51:06.856Z
61	DC_CREATED	admin	DC1776253870776	INFO	Created Delivery Challan 26/0007 for assaassaas	2026-04-15T11:51:10.802Z
62	DC_CREATED	admin	DC1776253875521	INFO	Created Delivery Challan 26/0008 for assaassaas	2026-04-15T11:51:15.550Z
63	DC_CREATED	admin	DC1776253909177	INFO	Created Delivery Challan 26/0009 for assaassaas	2026-04-15T11:51:49.199Z
64	DC_CREATED	admin	DC1776254245095	INFO	Created Delivery Challan 26/0010 for assaassaas	2026-04-15T11:57:25.126Z
65	DC_CREATED	admin	DC1776254256999	INFO	Created Delivery Challan 26/0011 for assaassaas	2026-04-15T11:57:37.029Z
66	DC_CREATED	admin	DC1776254262591	INFO	Created Delivery Challan 26/0012 for assaassaas	2026-04-15T11:57:42.623Z
67	CREATE	admin	ACC-MUM-0426-TVSU8B-8	INFO	Asset created: BAKON Iron Air Gun GS4000 (Accessory)	2026-04-15T12:01:44.528Z
68	CREATE	admin	ACC-MUM-0426-TVSU8B-8	INFO	Asset created: BAKON Iron Air Gun GS4000	2026-04-15T12:01:44.540Z
69	DC_CREATED	admin	DC1776321743085	INFO	Created Delivery Challan 26/0013 for Adasda	2026-04-16T06:42:23.165Z
70	DC_CREATED	admin	DC1776321759008	INFO	Created Delivery Challan 26/0014 for Adasda	2026-04-16T06:42:39.037Z
71	DC_CREATED	admin	DC1776322356027	INFO	Created Delivery Challan 26/0015 for asdasd	2026-04-16T06:52:36.046Z
72	DC_CREATED	admin	DC1776322364626	INFO	Created Delivery Challan 26/0016 for asdasd	2026-04-16T06:52:44.645Z
73	DC_CREATED	admin	DC1776322367874	INFO	Created Delivery Challan 26/0017 for asdasd	2026-04-16T06:52:47.901Z
74	DC_CREATED	admin	DC1776322679522	INFO	Created Delivery Challan 26/0018 for asdasd	2026-04-16T06:57:59.546Z
75	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-20T07:41:18.391Z
76	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-20T08:20:26.548Z
77	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-20T08:31:25.958Z
78	UPDATE	admin	DAT-MUM-0426-1DCDQ6-3	INFO	Asset updated: Broadstream Pendrive 8GB	2026-04-20T08:31:26.073Z
79	UPDATE_PROJECT	web	LOC-0426-790924-P	INFO	Project updated: buyername, buyeraddress, buyergstin, buyerstate, buyerstatecode, consigneename, consigneeaddress, consigneegstin, consigneestate, consigneestatecode, initials, owneremail, coordinatoremail	2026-04-20T11:35:25.170Z
80	UPDATE	admin	ACC-MUM-0426-B8FU04-B	INFO	Asset updated: undefined	2026-04-22T11:19:36.678Z
81	UPDATE	admin	ACC-MUM-0426-B8FU04-B	INFO	Asset updated: undefined	2026-04-22T11:19:36.679Z
82	UPDATE	admin	ACC-MUM-0426-OMRMVJ-B	INFO	Asset updated: sample	2026-04-23T04:26:12.502Z
83	UPDATE_IT_DETAILS	admin	ACC-MUM-0426-OMRMVJ-B	INFO	IT details updated: Network: DHCP	2026-04-23T04:26:12.506Z
84	UPDATE	admin	ACC-MUM-0426-OMRMVJ-B	INFO	Asset updated: sample	2026-04-23T04:26:12.612Z
85	DELETE	web	ACC-MUM-0426-OMRMVJ-B	INFO	Asset marked for deletion (30-day grace period)	2026-05-02T07:15:16.183Z
86	DELETE	web	ACC-MUM-0426-TVSU8B-8	INFO	Asset marked for deletion (30-day grace period)	2026-05-02T09:13:28.181Z
87	DELETE	web	MON-LOC-0426-RZQZ0T-C	INFO	Asset marked for deletion (30-day grace period)	2026-05-02T09:13:47.759Z
88	DELETE	web	MON-LOC-0426-GC8K8Z-Y	INFO	Asset marked for deletion (30-day grace period)	2026-05-02T09:14:04.527Z
89	DELETE	web	SRV-MUM-0426-FC88BN-6	INFO	Asset marked for deletion (30-day grace period)	2026-05-02T09:14:21.753Z
90	DELETE	web	LPT-ON-0326-5JUHYK-6	INFO	Asset marked for deletion (30-day grace period)	2026-05-02T09:14:35.231Z
91	CREATE	admin	PRT-MUM-0526-RHAOIO-D	INFO	Asset created: HP Laserjet Printer (Printer)	2026-05-02T09:18:28.117Z
92	CREATE	admin	PRT-MUM-0526-RHAOIO-D	INFO	Asset created: HP Laserjet Printer	2026-05-02T09:18:28.129Z
93	USER_DELETE	admin	User	WARN	Deleted user User	2026-05-02T11:13:40.793Z
94	DC_CREATED	admin	DC1777723424082	INFO	Created Delivery Challan 26/0019 for assaassaas	2026-05-02T12:03:44.143Z
95	USER_CREATE	admin	SwapnilM	INFO	Created user SwapnilM with role manager	2026-05-04T07:29:53.971Z
\.


--
-- Data for Name: auth_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.auth_tokens (id, user_id, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.companies (id, name, created_at) FROM stdin;
25451fa6-82a7-414b-9b40-341bcd1b7286	CINEOM	2026-03-16 11:16:16
\.


--
-- Data for Name: company_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.company_templates (id, company_id, template_type, template_data, created_at) FROM stdin;
1	\N	\N	\N	2026-03-17 06:13:28
\.


--
-- Data for Name: components; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.components (id, parentid, type, name, description, itemname, make, model, srno, status, category, lastupdated, noqr) FROM stdin;
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
DC1774589052923	26/0001	Sudhir Lodhi	2026-03-27	["AST001"]	Pending	data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOQAAADkCAYAAACIV4iNAAAAAklEQVR4AewaftIAAAwsSURBVO3BQW4kwZEAQfcC//9l3znGKYFCN6mUNszsH9ZaV3hYa13jYa11jYe11jUe1lrXeFhrXeNhrXWNh7XWNR7WWtd4WGtd42GtdY2HtdY1HtZa13hYa13jYa11jYe11jV++JDKX6qYVE4qJpVPVJyonFRMKlPFicpJxYnKVPGGyhsVk8obFScqU8Wk8pcqPvGw1rrGw1rrGg9rrWv88GUV36TyRsVfUjmp+KaKSWVSOan4popPVEwqk8o3VXyTyjc9rLWu8bDWusbDWusaP/wylTcqflPFpHJS8UbFGxWTylTxm1Smik+onFRMKicVk8o3qbxR8Zse1lrXeFhrXeNhrXWNH/7LVUwqU8VJxaRyojJVnKhMFZPKVDGpvFExqUwqU8Wk8omKSeWk4hMV/0se1lrXeFhrXeNhrXWNH/7LqZyonFRMFb9JZar4JpWTijcqTlSmihOVNyqmiv9lD2utazysta7xsNa6xg+/rOI3VbyhMqlMFZPKN1VMKm9UvKEyqZxUvFExqZxUnKhMKlPFN1Xc5GGtdY2HtdY1HtZa1/jhy1T+kspUMalMFZPKGxWTylTxiYpJ5URlqjipmFROVKaKSWWqmFROVKaKSeVEZao4UbnZw1rrGg9rrWs8rLWuYf/w/4jKVDGpTBVvqJxUvKEyVbyhclLxhspJxRsqU8X/Zw9rrWs8rLWu8bDWuob9wwdUpooTld9U8YbKN1WcqNyk4kTljYpJZar4JpWTihOVqWJSeaPiEw9rrWs8rLWu8bDWusYPv0zljYq/VDGpTBWTylTxRsWJyknFJ1QmlaliqjhR+YTKScVJxTep/Cc9rLWu8bDWusbDWusaP3yoYlI5qThROamYVKaKE5Wp4jepvFFxovJGxUnFGyqfUJkqJpVJZao4UTmpeKPiLz2sta7xsNa6xsNa6xo/fFnFicpUMVWcqEwVk8pJxaQyVbyhclJxojKpTBUnFZPKGypTxaTyiYoTlZOKE5WTipOKSeUNlaniEw9rrWs8rLWu8bDWusYPH1KZKt5QeaNiUjmpeEPljYpJZVJ5o2JS+YTKVHGi8kbFicpJxYnKVPEJlaniRGWqmCq+6WGtdY2HtdY1HtZa17B/+CKVNyreUJkqTlROKiaVk4o3VN6oOFF5o+I3qUwVb6hMFW+oTBWTyhsVk8pU8Zse1lrXeFhrXeNhrXWNHz6kMlVMKlPFpDJVTConKm9UTCpvqEwVn6h4o2JSeUNlqjhReUPlJhWTylQxqbyhMlV84mGtdY2HtdY1HtZa17B/+CKVNyomlaniRGWqeEPlpOJE5aTiROWNiknlmyreUJkq3lD5RMUnVE4qJpWp4pse1lrXeFhrXeNhrXUN+4f/IJWpYlI5qThROal4Q+Wk4kRlqphUpoo3VE4qJpU3Kk5UpopJ5aRiUjmpmFTeqJhU3qj4poe11jUe1lrXeFhrXeOHL1P5hMpUMan8JZWTihOVqWJSOVF5o2JS+UTFGxUnFZPKJ1ROKiaVk4pJ5URlqvjEw1rrGg9rrWs8rLWu8cOHVKaKN1SmikllqjhRmSreUJkqblYxqZyovKHyRsWJyonKScWkcqIyVUwqJxWTylTxTQ9rrWs8rLWu8bDWusYPv0xlqnijYlKZKqaKSeUTKlPFb6qYVKaKSWWqmFSmihOVqWJS+UTFGypvVLxRMamcVEwqU8UnHtZa13hYa13jYa11DfuHL1I5qXhDZaqYVKaKE5WpYlJ5o2JSeaNiUnmj4jepTBWTylQxqXyi4kTlExWTylQxqUwV3/Sw1rrGw1rrGg9rrWv88CGVk4pJ5aRiqjipmFROKj5RMamcVEwqJxWTylQxqZxUTConFVPFGypTxaRyUvGJik9UTCp/6WGtdY2HtdY1HtZa17B/+IDKVHGicrOKSWWqmFTeqJhU/ptUTCqfqJhUpooTlW+qOFGZKr7pYa11jYe11jUe1lrX+OFDFZPKScWkMlW8oXJS8YbKicpUcaIyqUwVJypTxRsqf6liUjlReUPlpOINlU+oTBWfeFhrXeNhrXWNh7XWNX74kMpJxSdUpoqTiknljYoTlROVN1SmijdUpoqTihOVE5Wp4o2KN1Q+oTJVfKLiNz2sta7xsNa6xsNa6xo//DKVT1R8U8Wk8kbFpHJSMalMFZPKGxVvqEwVU8UbKlPFicobFScqJxWfUJkqJpWp4hMPa61rPKy1rvGw1rqG/cMXqUwVJyq/qeINlU9UfELlN1VMKlPFpHJS8YbKScWJyk0qvulhrXWNh7XWNR7WWtf44csqJpWp4qTiRGWqOFE5qfgmlanijYpJZaqYVKaKSeUTFScqv0llqnhDZaqYVE4qJpVJZar4xMNa6xoPa61rPKy1rmH/8EUqf6niDZWTikllqphUflPFicpJxYnKVDGpTBWfUJkqJpWTiknlpGJSmSo+oTJVfOJhrXWNh7XWNR7WWtf44UMqU8WJylQxqUwVJyonFScVk8qJylRxovKXKv6TVN5Q+UTFicpUMalMFW9UfNPDWusaD2utazysta5h//BFKlPFJ1TeqDhR+aaKv6QyVbyhMlW8ofJNFZPKJyomlTcqJpWpYlKZKj7xsNa6xsNa6xoPa61r2D98QGWqOFGZKiaVqWJSmSomlaliUjmpmFTeqHhDZap4Q+WNim9SmSpOVN6oOFF5o2JSOamYVE4qPvGw1rrGw1rrGg9rrWv88KGKE5U3KiaVqWJSeaPiRGWqmFROVD6h8pdUPlExqZxUTCqfqDhR+aaK3/Sw1rrGw1rrGg9rrWv88CGVNyreqJhUpopJ5Q2VNyomlanim1ROKk5U3qiYVE5UpooTlb9UcVLxCZWp4hMPa61rPKy1rvGw1rrGD5dReUNlqphUpoqTijcqJpWpYlI5qZgqTlROKv6SylRxUvGbVKaKSWWqeKPimx7WWtd4WGtd42GtdY0f/pjKVHFSMamcqEwVJxWTylTxRsWkMlWcqLxRcaIyVZyoTBU3U/kmlZOKSWWq+MTDWusaD2utazysta7xwy+rOFE5UZkq3lD5hMobFX9JZao4UZkqJpVJZao4UTmpeENlqnij4hMVJxXf9LDWusbDWusaD2uta/zwoYpJZVJ5o+JEZap4o+ITKp9QmSpOKr6p4o2KSeWkYlI5UZkq3qg4UTmpmFQmlaliUpkqPvGw1rrGw1rrGg9rrWv88Msq3lD5TSpTxaTyTRWTyknFpDJVTCpvqJxUvFExqbxR8QmVk4o3KiaVSWWq+KaHtdY1HtZa13hYa13D/uGLVN6oeENlqjhR+UTFpPJGxRsqU8UbKlPFicpU8QmVqeITKlPFJ1ROKt5QmSo+8bDWusbDWusaD2uta/zwIZU3Kt5QuVnFpDKpTBWTyonKJ1Q+oTJVnFScqEwVk8qJyl9S+UsPa61rPKy1rvGw1rqG/cN/MZWpYlI5qZhUPlHxhspUMalMFW+ofKJiUpkqPqEyVUwqU8WkMlW8oXJScaIyVXziYa11jYe11jUe1lrX+OFDKn+p4o2KNypOVKaKSeUTKm+oTBWfqJhUTlSmiknlDZWpYlJ5Q2WqeENlqpgqvulhrXWNh7XWNR7WWtf44csqvknlDZU3KiaVk4qTihOVb6p4o+JE5aTiROWNit9U8UbFpDKpnFR84mGtdY2HtdY1HtZa1/jhl6m8UfGJihOVNyomlZOKT1RMKpPKJ1SmiqliUplUTiomlaniRGWqeEPlEypvVHzTw1rrGg9rrWs8rLWu8cP/GJWpYqqYVN6oOFE5qZhUJpWTikllqnhDZaqYKk5UJpVPVJxUnKicVJyoTBUnKlPFJx7WWtd4WGtd42GtdY0f/stVTCqTylQxVUwqf6niExVvqHxTxRsqJxWTylQxqUwVk8qJylRxovKbHtZa13hYa13jYa11jR9+WcV/UsVvUpkqPqHymyomlUnlpGJSmSp+k8obFScVk8p/0sNa6xoPa61rPKy1rvHDl6n8JZU3VKaKqWJS+YTKVPGXKiaVk4pJZVJ5Q+WkYlL5hMpJxaQyVbyh8k0Pa61rPKy1rvGw1rqG/cNa6woPa61rPKy1rvGw1rrGw1rrGg9rrWs8rLWu8bDWusbDWusaD2utazysta7xsNa6xsNa6xoPa61rPKy1rvGw1rrG/wEBro8d12udFwAAAABJRU5ErkJggg==	System	2026-03-27T05:24:12.930Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"Anurag","address":"Home","gstin":"GHJ","stateName":"Gujarat","stateCode":"87"},"buyer":{"name":"Anurag","address":"A1","gstin":"GGH","stateName":"Maharashtra","stateCode":"27"},"meta":{"customerName":"Sudhir Lodhi","deliveryDate":"2026-03-27","referenceNo":"Test Project 4","buyerOrderNo":"01","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"2026-03-18","logoUrl":""},"items":[{"sr":1,"assetId":"AST001","description":"Dell Latitude Laptop - Latitude 5420","hsn":"","qty":1,"per":"NO","rate":0,"amount":0}]}
DC1775550807634	26/0002	Sudhir Lodhi	2026-04-07	["LPT-ON-0326-5JUHYK-6"]	Pending	data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPQAAAD0CAYAAACsLwv+AAAAAklEQVR4AewaftIAAA4ESURBVO3BQY4cy5LAQDLR978yR0tfBZCoaun9GDezP1hrXeFhrXWNh7XWNR7WWtd4WGtd42GtdY2HtdY1HtZa13hYa13jYa11jYe11jUe1lrXeFhrXeNhrXWNh7XWNR7WWtf44UMqf1PFicpUcaJyUvGGyknFpHJSMalMFZPKScVvUjmpmFSmiknlpOJEZap4Q+VvqvjEw1rrGg9rrWs8rLWu8cOXVXyTyhsVN1GZKk4qJpVJZaqYVKaKE5WpYlI5qTipmFQmlTdUpoo3Kr5J5Zse1lrXeFhrXeNhrXWNH36ZyhsVb6h8U8UbKicVJxWTylQxqUwVk8pJxUnFpDJVnKhMFScqJxWfqJhUvknljYrf9LDWusbDWusaD2uta/xwmYpJZao4UTmpmComlUnlpOJE5URlqjhR+YTKScWJylQxqZxUvKEyVUwqU8X/soe11jUe1lrXeFhrXeOHy1WcqJxUTCpTxVQxqUwVk8pJxYnKpPKbKk5UTipOKk5UTireqLjJw1rrGg9rrWs8rLWu8cMvq/ibVKaKSWWqmFQmlaliUjmp+ITKVHFS8YbKVDGpnKhMFZPKpDJV/C+r+C95WGtd42GtdY2HtdY1fvgylX+pYlKZKiaVqWJSeaNiUpkqTiomlU+oTBX/UsWkMlVMKlPFpPIJlaniROW/7GGtdY2HtdY1HtZa1/jhQxX/JSpTxaTyCZUTlU+oTBWfqPgmlaniDZU3Kk4q3lCZKk4q/pc8rLWu8bDWusbDWusa9gcfUJkqJpVvqjhROan4hMpU8YbKVHGi8jdVfEJlqjhROamYVN6omFROKiaVb6r4TQ9rrWs8rLWu8bDWuob9wRepTBUnKlPFicpUMam8UfEJlZOKSeWNihOVT1S8oTJVTCqfqJhUpoo3VE4qJpWp4g2VT1R84mGtdY2HtdY1HtZa1/jhl6mcVEwqb6icVEwqn1A5qZhUTiomlUnlpOJvqnij4jepfEJlqphUpopJ5aRiUpkqvulhrXWNh7XWNR7WWtf44csqTlQmlaniROWkYlKZKk5Upoqp4kTlpGJSOamYVE5UvqliUpkqvkllqjip+ITKJyomlUllqphUpopPPKy1rvGw1rrGw1rrGj98SOWk4qTiRGWq+CaVqWJSmSpOKn5TxUnFicpU8UbFScWJyidUTiomlU9UnKicVEwqv+lhrXWNh7XWNR7WWtf44UMVk8obKlPFVHGi8i+pTBWTyknFicpU8YmKE5WpYlKZKk5UPqEyVZyoTBUnKpPKScVUcaLyNz2sta7xsNa6xsNa6xr2Bx9QmSpOVL6pYlKZKk5Upop/SeWkYlI5qThRmSomlaniN6lMFf+SylQxqUwVJypTxTc9rLWu8bDWusbDWusa9ge/SGWqOFGZKiaVqeJE5ZsqJpWp4r9EZar4JpWTikllqnhDZao4UZkqJpWp4kTlpGJSeaPiEw9rrWs8rLWu8bDWusYPf5nKVDFVTConKm9UTCrfpPJGxaQyVZyonFR8QmWqOKk4qZhU3qiYVKaKNyomlaliqphUJpV/6WGtdY2HtdY1HtZa17A/+CKVk4rfpPJGxaTyL1V8k8pUMalMFW+onFRMKm9UTConFW+oTBWTyhsV/9LDWusaD2utazysta5hf/AXqZxUTCpTxaQyVUwqU8VvUvmmihOVk4pJ5aRiUpkqJpWp4g2VqeJE5aRiUpkqTlSmihOVk4q/6WGtdY2HtdY1HtZa1/jhQypTxaQyVZyoTBWTylTxCZWpYlI5qZgqJpU3Kk5UpooTlZOKT1RMKlPFf5nKGypTxX/Jw1rrGg9rrWs8rLWuYX/wD6l8U8WkclIxqZxUfJPKScWJyjdVTCpTxaRyUvE3qUwVn1CZKk5UpopJZar4poe11jUe1lrXeFhrXcP+4AMqU8VvUpkqJpU3Kt5QmSpOVE4qPqEyVfxLKicVk8pJxYnKVHGiMlVMKicVk8pU8S89rLWu8bDWusbDWusa9gcfUDmpmFT+popJ5TdVTCr/UsWkMlWcqJxUTCpTxW9SmSo+oTJVnKicVJyoTBWfeFhrXeNhrXWNh7XWNX74UMWJyknFJ1S+qeJE5URlqphU3qg4UTlRmSpOVE4qTiomlaliUpkqJpWTikllqphUpoo3VKaKN1Smim96WGtd42GtdY2HtdY17A++SGWqmFR+U8Wk8l9ScaLyL1VMKlPFpDJVvKHyRsWkMlVMKlPFpPKbKiaVk4pPPKy1rvGw1rrGw1rrGj/8MpU3Kt5QmVQ+UfEJlaliUjmpmFSmikllqnhDZVKZKk4qJpWTit+kcqJyUvGGylTxRsU3Pay1rvGw1rrGw1rrGj/8sopJ5Q2VqeKbKiaVNyqmik+ofJPKVPEJlZOKT1RMKpPKVDGpnFRMKicqU8UbKicqU8UnHtZa13hYa13jYa11jR8+pDJVTCqfqHijYlI5UZkqJpUTlU9UTCpTxScq3qiYVKaKE5VvqphUTiomlUnljYo3VKaKv+lhrXWNh7XWNR7WWtewP/iAylTxhso3VZyoTBWTylQxqUwVb6icVEwqU8Wk8psqJpU3Kt5QmSpOVKaKSeVvqphU3qj4xMNa6xoPa61rPKy1rvHDhyomlU9UnKhMFScq31TxhsobKlPFpPJGxaQyVUwqJxWTyonKScVUMalMFVPFGxUnKicVJypTxYnKNz2sta7xsNa6xsNa6xo/fEhlqnhD5URlqjhROak4qZhU3qg4qThRmVSmikllqnhDZaqYVD5R8ZtUTio+UTGpfFPFNz2sta7xsNa6xsNa6xr2B1+kclJxojJVTCpTxaQyVUwqU8WkclLxN6l8omJSmSpOVKaKSeWk4mYqb1T8poe11jUe1lrXeFhrXcP+4AMq/1LFJ1TeqJhUTipOVN6omFSmijdUPlExqbxRMalMFScqU8WkMlVMKm9UfELlpOITD2utazysta7xsNa6hv3BB1SmikllqphUTiq+SeWk4kTlmyreUHmjYlKZKk5UTipOVKaKSeWNik+oTBWTyknFpHJSMalMFd/0sNa6xsNa6xoPa61r/PChikllqviEyknFicq/VDGpnKhMFW9UvKHyRsWkMlVMFScVn1CZKiaVT1S8UXFS8Zse1lrXeFhrXeNhrXUN+4MPqJxU/C9RmSq+SeWk4jepTBWfUJkqJpWpYlKZKiaVk4pvUvmXKj7xsNa6xsNa6xoPa61r2B98kcpJxRsqU8WJylRxojJVvKHyRsU3qXxTxaQyVZyonFScqPxNFW+onFScqEwV3/Sw1rrGw1rrGg9rrWv88CGVqeJEZaqYVKaKSWWqeEPlRGWq+ETFGypvVLyhcqIyVUwqJxWTyonKScVvUpkqTiomlU+oTBWfeFhrXeNhrXWNh7XWNX74x1SmikllqvhExaTyhspUMalMKlPFpDJVTConKicVJxUnKm+oTBUnFZPKpHJScaJyUjGpfJPK3/Sw1rrGw1rrGg9rrWv88GUqJxWTyknFGxUnKt+kMlV8QuWkYlKZKt5QmSqmihOVE5Wp4o2Kb6qYVKaKN1QmlZOK3/Sw1rrGw1rrGg9rrWv88KGKSWWqmFSmihOVqeINlTcqJpWTihOVk4oTlUnlDZWp4kTlpOKk4g2VqeITKlPFpHKiMlWcVJyonKhMFZ94WGtd42GtdY2HtdY17A++SOWkYlI5qXhD5aRiUvlExaRyUjGpnFR8k8pU8YbKVDGpfFPFpDJVTConFZPKScWkclJxojJVfNPDWusaD2utazysta5hf/ABlZOKSeUTFScqJxVvqEwVk8obFScqU8WkclIxqUwVJyonFW+oTBWTylRxonJSMalMFW+ofKLiRGWq+MTDWusaD2utazysta5hf/BFKicVn1A5qZhUpooTlaliUpkqJpWp4jepTBVvqJxUTCpvVLyh8psqJpWp4hMqb1R808Na6xoPa61rPKy1rvHDl1WcqEwVJypTxaQyqUwVk8pU8UbFpHKi8omKN1Q+UXFSMalMFd9UMamcVHxC5ZsqJpXf9LDWusbDWusaD2uta/zwl1W8UfGbVP6lim+qeENlUnmjYlJ5o2KqOKmYVE5UpoqTijdUpopJ5W96WGtd42GtdY2HtdY1fviQyt9UMVVMKicVJypvVLyhMqmcVHxCZao4qXhD5ZtUpopJ5Y2KSeUNlaniRGWqmFQmlaniEw9rrWs8rLWu8bDWusYPX1bxTSonKlPFpPJNKicVk8pU8QmVNyq+SWWqmFSmikllUvlExaRyUjGpnFT8popvelhrXeNhrXWNh7XWNX74ZSpvVHxC5Y2KNyomlUnlDZWTijdUPqEyVUwVb6h8U8WkMlVMKm+ofKJiUvmbHtZa13hYa13jYa11jR/+n6k4UZkqvknlpOKk4kTljYo3VKaKT1RMKpPKVDFVnFScVEwqn1D5lx7WWtd4WGtd42GtdY0fLlMxqZyovKHyL6lMFZ9QmSomlanijYoTlaniEypTxYnKVDGpnFRMKlPFpPKbHtZa13hYa13jYa11jR9+WcVvqphUpopJ5aRiUpkqTlTeqPiEylRxojJVTCpTxYnKicpUcaLyRsVU8UbFpHJSMamcqPxND2utazysta7xsNa6xg9fpvI3qUwVb1R8QuWbVKaKqWJSmVSmiqliUpkqTlS+qeKbVE4qJpXfVPE3Pay1rvGw1rrGw1rrGvYHa60rPKy1rvGw1rrGw1rrGg9rrWs8rLWu8bDWusbDWusaD2utazysta7xsNa6xsNa6xoPa61rPKy1rvGw1rrGw1rrGv8HcpzoG35SoqsAAAAASUVORK5CYII=	admin	2026-04-07T08:33:27.643Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"Rinto V","address":"Amazon Seller Services Private Limited\\n401 to 425 Vipul Agora 4th Floor,\\nFourth Floor of the Vipul Agora Commercial Complex\\nMG road (Mehrauli-Gurgaon Road).\\nGurgaon, Haryana 122001","gstin":"06AAICA3918J1ZM","stateName":"Haryana","stateCode":"122001"},"buyer":{"name":"Rinto V","address":"Global Finance Operations - Scanning Team (Amazon Development Centre (India)\\nPvt Ltd.)\\nPlot No.12/P, 13, 14 and 15/P, Financial District, Nanakramguda,\\nSerilingampally Mandal, Hyderabad, Telangana 500032\\nIndia","gstin":"06AAICA3918J1ZM","stateName":"Telangana","stateCode":"500032"},"meta":{"customerName":"Sudhir Lodhi","deliveryDate":"2026-04-07","referenceNo":"Amazon ","buyerOrderNo":"I8-19870659 V1","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"LPT-ON-0326-5JUHYK-6","description":"Sample","hsn":"sdsd","qty":1,"per":"NO","rate":30000,"amount":30000}]}
DC1776162766645	26/0003	RintoV	2026-04-14	["ACC-MUM-0426-B8FU04-B"]	Pending	data:image/png;base64,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	admin	2026-04-14T10:32:46.651Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"RintoV","address":"Amazon Seller Services Private Limited\\n401 to 425 Vipul Agora 4th Floor,\\nFourth Floor of the Vipul Agora Commercial Complex\\nMG road (Mehrauli-Gurgaon Road).\\nGurgaon, Haryana 122001","gstin":"06AAICA3918J1ZM ","stateName":"Telangana","stateCode":""},"buyer":{"name":"Rinto V","address":"Global Finance Operations - Scanning Team (Amazon Development Centre (India)\\nPvt Ltd.)\\nPlot No.12/P, 13, 14 and 15/P, Financial District, Nanakramguda,\\nSerilingampally Mandal, Hyderabad, Telangana 500032\\nIndia","gstin":"06AAICA3918J1ZM ","stateName":"Haryana","stateCode":""},"meta":{"customerName":"RintoV","deliveryDate":"2026-04-14","referenceNo":"","buyerOrderNo":"I8-19870659","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":""},"items":[{"sr":1,"assetId":"ACC-MUM-0426-B8FU04-B","description":"sample - asdasd","hsn":"","qty":1,"per":"NO","rate":5000,"amount":5000}]}
DC1776253672075	26/0004	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:47:52.078Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776253731705	26/0005	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:48:51.706Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776253866827	26/0006	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:51:06.833Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776253870776	26/0007	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:51:10.777Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776253875521	26/0008	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:51:15.527Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776253909177	26/0009	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:51:49.178Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776254245095	26/0010	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:57:25.101Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":""},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776254256999	26/0011	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:57:37.001Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":""},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776254262591	26/0012	assaassaas	2026-04-15	["SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-04-15T11:57:42.598Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-04-15","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"Tujhya Sathi ","orderDate":"","logoUrl":""},"items":[{"sr":1,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":796500,"amount":796500}]}
DC1776321743085	26/0013	Adasda	2026-04-16	["LPT-ON-0326-5JUHYK-6"]	Pending	data:image/png;base64,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	admin	2026-04-16T06:42:23.087Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"Adasda","deliveryDate":"2026-04-16","referenceNo":"Dneg","buyerOrderNo":"","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"LPT-ON-0326-5JUHYK-6","description":"Sample","hsn":"","qty":1,"per":"NO","rate":30000,"amount":30000}]}
DC1776321759008	26/0014	Adasda	2026-04-16	["LPT-ON-0326-5JUHYK-6"]	Pending	data:image/png;base64,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	admin	2026-04-16T06:42:39.014Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"Adasda","deliveryDate":"2026-04-16","referenceNo":"Dneg","buyerOrderNo":"","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"LPT-ON-0326-5JUHYK-6","description":"Sample","hsn":"","qty":1,"per":"NO","rate":30000,"amount":30000}]}
DC1776322356027	26/0015	asdasd	2026-04-16	["LPT-ON-0326-5JUHYK-6"]	Pending	data:image/png;base64,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	admin	2026-04-16T06:52:36.028Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"asdasd","deliveryDate":"2026-04-16","referenceNo":"Dneg","buyerOrderNo":"","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"LPT-ON-0326-5JUHYK-6","description":"Sample","hsn":"","qty":1,"per":"NO","rate":30000,"amount":30000}]}
DC1776322364626	26/0016	asdasd	2026-04-16	["LPT-ON-0326-5JUHYK-6"]	Pending	data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPQAAAD0CAYAAACsLwv+AAAAAklEQVR4AewaftIAAA53SURBVO3BQY4YybLgQDJR978yR0tfBZDIkvr9GDezP1hrXeFhrXWNh7XWNR7WWtd4WGtd42GtdY2HtdY1HtZa13hYa13jYa11jYe11jUe1lrXeFhrXeNhrXWNh7XWNR7WWtf44SOVf6niDZWpYlL5X1YxqUwVk8oXFV+onFRMKlPFb1KZKt5Q+ZcqvnhYa13jYa11jYe11jV++GUVv0nlN6m8UXGiMlVMKlPFpHKiMlWcVEwqU8UbKicVU8WkclIxqUwVk8pU8YbKVPFGxW9S+U0Pa61rPKy1rvGw1rrGD3+ZyhsVb6icVJyovKFyovJGxaQyVUwqU8Wk8psqTlROKk5UTlSmijcqJpXfpPJGxd/0sNa6xsNa6xoPa61r/HCZikllqjipmFS+qJhUpooTlROVqeJEZao4UflNKlPFicqJyhsVk8pU8X/Zw1rrGg9rrWs8rLWu8cPlKr6omFROKiaVqeKNihOVSeUNlZOKN1QmlaniROWNihOVk4qbPKy1rvGw1rrGw1rrGj/8ZRX/kspUMal8UTGpTConKlPFb6p4Q+ULlZOKSWWqmCpOVKaK/1LF/5KHtdY1HtZa13hYa13jh1+m8l+qmFSmiknlRGWqOKmYVKaKSWWqmFSmijdUpoqTikllqjipmFSmikllqphUpopJZap4Q2WqOFH5X/aw1rrGw1rrGg9rrWv88FHF/xKVqeJvqjipmFROVKaKSeWNit+kMlWcVJxUnFRMKlPFFxUnFf+XPKy1rvGw1rrGw1rrGvYHH6hMFZPKb6r4QmWqmFSmiknljYpJZao4UZkqJpV/qeJEZap4Q2WqmFTeqPhC5TdV/E0Pa61rPKy1rvGw1rqG/cEvUpkq3lCZKt5QOak4Ufmi4kTlpOINlTcq3lA5qThRmSreUDmpOFE5qZhUpoo3VL6o+OJhrXWNh7XWNR7WWtewP/hAZao4UZkqJpWTijdUpopJ5f+Sii9Uvqh4Q2WqmFSmijdUflPFpDJVTConFZPKVPGbHtZa13hYa13jYa11DfuD/5DKScWkMlW8ofJGxaRyUjGpvFFxojJVTConFZPKScWkMlVMKlPFicpUMalMFf+SyknFpHJSMalMFV88rLWu8bDWusbDWusa9gd/kcpUMal8UTGpnFScqJxUTConFZPKScXfpHJScaJyUjGpvFFxonJSMamcVLyh8kbFpHJS8cXDWusaD2utazysta7xwy9TmSpOKt5QmVROKiaVk4pJ5Y2Kk4oTlZOKSWWqeKNiUpkqTir+JpWp4kRlqphUJpU3KiaVqWJSOan4TQ9rrWs8rLWu8bDWusYPH6m8oTJVTConFZPKVDGpTBWTyknFpDJVTConFZPKScVvqphUpopJZao4UZkqTlROKk5Upoo3Kk5UvqiYVCaVqeKLh7XWNR7WWtd4WGtd44ePKiaVSWWqeKNiUpkqJpWpYlKZKiaVk4o3Kk4q3lCZKiaVNypOKiaVL1SmijdUpooTlS8qvlA5qfhND2utazysta7xsNa6hv3BBypTxRcq/0sqJpU3KiaVqeJEZaqYVKaKE5WTikllqphUporfpHJSMamcVHyhclJxonJS8cXDWusaD2utazysta5hf/CByhsVv0nlpGJSOan4QuWNijdUvqiYVKaKE5WpYlKZKk5U/qaKE5WpYlI5qThReaPii4e11jUe1lrXeFhrXeOH/zEqJxVTxaTyN6lMFScVb6hMFV9UTCpvqEwVk8pU8UbFpDJVnKhMFZPKVDFVTCpTxYnK/5KHtdY1HtZa13hYa13D/uAvUnmj4jepTBUnKicVk8pUMalMFV+oTBUnKicVb6hMFZPKVHGi8kXFFypvVEwqU8UbKlPFFw9rrWs8rLWu8bDWuob9wQcqU8UXKicVX6hMFZPKVDGpnFScqLxRcaIyVUwqb1RMKlPFpHJS8YXKVDGpnFR8oTJVfKFyUvHFw1rrGg9rrWs8rLWuYX/wf5jKVPGGylQxqZxUnKhMFZPKVHGiclLxhcpUMalMFZPKScWk8l+qmFS+qPgvPay1rvGw1rrGw1rrGvYHv0jlpGJS+aJiUpkqJpU3KiaVk4pJ5b9UMalMFb9JZao4UZkq3lA5qXhD5aTiRGWqOFGZKr54WGtd42GtdY2HtdY17A9+kcpJxaQyVbyhMlVMKicVJyonFZPKScWJylRxojJVfKFyUnGi8psq3lB5o+INlaniROWk4jc9rLWu8bDWusbDWusa9ge/SGWqmFT+pooTlZOKE5Wp4guV/yUVk8pUMalMFW+ofFFxojJVTCq/qWJSmSr+poe11jUe1lrXeFhrXeOHj1TeqJhUpoo3VCaVk4pJ5URlqjhRmSpOKk5UpopJZap4Q+Wk4qRiUvmi4guVLyreUDmpmFSmit/0sNa6xsNa6xoPa61r/PCPqbyhMlWcVEwqk8qJylTxm1TeqPhCZar4QuWk4g2VSeWLiknlC5Wp4g2VE5Wp4ouHtdY1HtZa13hYa13jh48qJpXfVPGGyknFpDJVTCpTxaRyonJSMan8poovVKaKN1S+qJhUvlB5o+INlaniX3pYa13jYa11jYe11jV++EhlqjipmFQmlb9JZaqYVL6omFS+UJkqTlR+U8Wk8kXFpPJGxRcVk8qk8kXFpPJGxRcPa61rPKy1rvGw1rrGD/+YylQxqUwVk8oXFW9UTCpTxaQyVbxRMalMKm9UTCpTxYnKVDGpTBUnKm+oTBX/pYoTlaniROU3Pay1rvGw1rrGw1rrGj98VDGpTBVvVEwqU8WkMlVMKicqX6h8oXJScaIyVZxUvFExqZyonFRMKlPFicobFZPKVDGpTBWTym+q+E0Pa61rPKy1rvGw1rrGDx+pTBW/qeINlROVk4o3KiaVSWWqOKk4UTlRmSomlaniROWkYlJ5o+KLii9UpopJZaqYVE5Upoq/6WGtdY2HtdY1HtZa1/jhl6lMFScq/1LFGypvVLxRMalMFScVb1ScqJxUnFRMKl+oTBWTylQxqUwVJypvVLyhclLxxcNa6xoPa61rPKy1rvHDP1YxqUwVX6hMFScqJxUnKlPFicpUMVWcVEwqJxWTyknFpDKpTBWTyr9UcVIxqUwVX6hMFZPKVPE3Pay1rvGw1rrGw1rrGvYHv0jljYpJ5f+yiknli4q/SeWNiknlpOK/pPJFxYnKVHGiMlX8poe11jUe1lrXeFhrXcP+4AOV31TxhspJxYnKScWkclJxonJS8YbKVHGiMlX8TSpTxaQyVUwqU8WJylTxhsoXFZPKGxVfPKy1rvGw1rrGw1rrGvYHf5HKVHGi8kXFpDJVfKHyRsUbKlPFGypvVJyonFRMKicVb6i8UTGpvFFxojJVTCpvVPymh7XWNR7WWtd4WGtd44ePVE4qJpWpYqp4Q2VSOVF5o+KkYlL5ouJE5aTiRGVSOak4UZkqJpUTlTcq3qg4UflNFZPKv/Sw1rrGw1rrGg9rrWvYH3ygMlVMKr+p4kTlpOJE5aRiUpkqTlROKiaVNyomlZOKE5Wp4kRlqjhRmSomlZOKE5WTiknlpGJS+U0VXzysta7xsNa6xsNa6xo//DKVqWJSmSomlaliUjmpmFQmlTcqJpU3VN5QOamYVE4qTlSmiqliUpkqTlS+qJhUvqiYVKaKE5WpYlKZKk5UftPDWusaD2utazysta7xwy+rOKl4Q+WkYlKZKiaVv0nlpGJSmSomlUnlROWNihOVE5Wp4g2VSWWqeENlqphU3lCZKt5QOan4TQ9rrWs8rLWu8bDWusYP/5jKVHFSMalMKlPFpHJSMalMKicVk8pUMamcqEwVb6hMFZPKpDJVTBWTylQxqXxR8ZtUpopJ5aTii4pJ5W96WGtd42GtdY2HtdY1fvhlKlPFicqJyknFpDJVnKicVJyonKicVEwqJyonFScVb6i8UTGpTBWTyqQyVfxNFScqJxVvVEwqU8UXD2utazysta7xsNa6hv3BL1I5qfhNKm9UTConFScqJxUnKm9UTConFScqU8WJyhsVJypTxaQyVZyoTBUnKicVJypTxaRyUvGbHtZa13hYa13jYa11jR9+WcWJylRxojJVTBWTyhcVk8pUcVIxqUwVb1R8ofKbKiaVqeJEZaqYVKaKSeVfUvmi4l96WGtd42GtdY2HtdY17A/+D1P5omJSmSomlZOKE5UvKiaVqeINlZOKSWWqmFROKt5QmSomlaniDZWp4g2VqWJSOan4TQ9rrWs8rLWu8bDWusYPH6n8SxVTxaRyUnFS8UbFpPJGxaQyVXyhMlV8UTGpnFRMKlPFpDJVTCpfqLyhMlWcqEwVk8qkMlV88bDWusbDWusaD2uta/zwyyp+k8qJyknFpDJVvFFxUjGpTBUnFScqb1S8UTGpnFRMKpPKVPGGyhsqJxWTyknF31Txmx7WWtd4WGtd42GtdY0f/jKVNyq+qDipmFROKk5UpoqpYlKZKiaVqeINld9U8ZtU3qg4UZkqJpU3VL6omFT+pYe11jUe1lrXeFhrXeOHy6lMFVPFFxWTyknFpDJVnFScqEwVk8pUcaJyUnFSMamcVEwqJxUnFScVk8pUcaIyqfyXHtZa13hYa13jYa11jR/+P6PyRcUXKicqb1R8ofJGxRsqU8WJylQxqUwqJxWTyknFpDJVTBWTylQxqfxND2utazysta7xsNa6xg9/WcXfVDGpvFExqXxR8YXKScWkMlW8UTGpTBUnKicVX6icVHxR8YXKicq/9LDWusbDWusaD2uta/zwy1T+JZWTiknlpOJEZao4UZkq3qiYVN5QmSomlanijYoTlaliUvlC5Y2KSeWk4ouKf+lhrXWNh7XWNR7WWtewP1hrXeFhrXWNh7XWNR7WWtd4WGtd42GtdY2HtdY1HtZa13hYa13jYa11jYe11jUe1lrXeFhrXeNhrXWNh7XWNR7WWtf4f0i0VBvL8EJ3AAAAAElFTkSuQmCC	admin	2026-04-16T06:52:44.627Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"asdasd","deliveryDate":"2026-04-16","referenceNo":"Dneg","buyerOrderNo":"","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"LPT-ON-0326-5JUHYK-6","description":"Sample","hsn":"","qty":1,"per":"NO","rate":30000,"amount":30000}]}
DC1776322367874	26/0017	asdasd	2026-04-16	["LPT-ON-0326-5JUHYK-6"]	Pending	data:image/png;base64,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	admin	2026-04-16T06:52:47.880Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"asdasd","deliveryDate":"2026-04-16","referenceNo":"Dneg","buyerOrderNo":"","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"LPT-ON-0326-5JUHYK-6","description":"Sample","hsn":"","qty":1,"per":"NO","rate":30000,"amount":30000}]}
DC1776322679522	26/0018	asdasd	2026-04-16	["LPT-ON-0326-5JUHYK-6"]	Pending	data:image/png;base64,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	admin	2026-04-16T06:57:59.524Z	{"company":{"name":"Cineom HQ Mumbai","address":"C-4 Goldline Business Center, Link Rd, Malad (W), Mumbai 400064","gstin":"27AABCC1880G1ZT","cin":"U32100MH2000PLC123797","stateName":"Maharashtra","stateCode":"27"},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"asdasd","deliveryDate":"2026-04-16","referenceNo":"Dneg","buyerOrderNo":"","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":"/uploads/1773728087911-Cineom Tag.png"},"items":[{"sr":1,"assetId":"LPT-ON-0326-5JUHYK-6","description":"Sample","hsn":"","qty":1,"per":"NO","rate":30000,"amount":30000}]}
DC1777723424082	26/0019	assaassaas	2026-05-02	["ACC-MUM-0426-OMRMVJ-B","SRV-MUM-0426-FC88BN-6"]	Pending	data:image/png;base64,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	admin	2026-05-02T12:03:44.080Z	{"company":{"name":"","address":"","gstin":"","cin":"","stateName":"","stateCode":""},"consignee":{"name":"assaassaas","address":"saasas","gstin":"asassa","stateName":"assaasa","stateCode":"assasaas"},"buyer":{"name":"Aassa","address":"asaas","gstin":"assa","stateName":"saasas","stateCode":"sasa"},"meta":{"customerName":"assaassaas","deliveryDate":"2026-05-02","referenceNo":"Dneg","buyerOrderNo":"PO89765","dispatchDocNo":"","otherReferences":"","dispatchedThrough":"","destination":"","termsOfDelivery":"","orderDate":"","logoUrl":""},"items":[{"sr":1,"assetId":"ACC-MUM-0426-OMRMVJ-B","description":"sample - asdasd","hsn":"","qty":1,"per":"NO","rate":0,"amount":0},{"sr":2,"assetId":"SRV-MUM-0426-FC88BN-6","description":"dell pe r660xs - R660XS","hsn":"","qty":1,"per":"NO","rate":0,"amount":0}]}
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
EMP1775033279010	1181	Arnav Thatte	IT / AV	AV Engineer			ACTIVE	2026-04-01T08:47:59.012Z
\.


--
-- Data for Name: folders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.folders (id, name, parentid, icon, module, createdby, "timestamp") FROM stdin;
IT_ROOT	IT Assets	\N	💻	IT	\N	\N
NON_IT_ROOT	Non-IT Assets	\N	📦	NON_IT	\N	\N
Hardware	Hardware	IT_ROOT	💻	IT	\N	2026-05-21T18:40:17.548Z
Networking	Networking	IT_ROOT	🌐	IT	\N	2026-05-21T18:40:17.567Z
Media & Others	Media & Others	IT_ROOT	📁	IT	\N	2026-05-21T18:40:17.573Z
\.


--
-- Data for Name: hsn_codes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.hsn_codes (code, description, gst_rate) FROM stdin;
\.


--
-- Data for Name: knex_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.knex_migrations (id, name, batch, migration_time) FROM stdin;
1	20260417060510_create_initial_schema.js	1	2026-04-17 11:54:15.469+00
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
1	2	IP	38.056103	8.069417
\.


--
-- Data for Name: layouts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.layouts (id, name, imageurl, projectid) FROM stdin;
1	Office Plan	\N	\N
2	Office Plan	\N	\N
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.password_resets (id, email, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permissions (key, description) FROM stdin;
module.assets.access	Access asset views and operations
module.admin.access	Access admin area
module.settings.access	Access settings area
module.employees.access	Access employees area
module.network_scanner.access	Access network scanner
module.network.access	Access network tools and credentials
asset.view	View assets
asset.create	Create assets
asset.edit	Edit assets
asset.delete	Delete assets
asset.search	Search assets
category.create	Create categories
category.delete	Delete categories
user.manage	Manage users
logs.view	View change logs
asset.view_price	View asset value/price
asset.edit_price	Edit asset value/price
\.


--
-- Data for Name: project_assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.project_assets (projectid, assetid, assigneddate, type) FROM stdin;
PRJ1773724147996	LPT-MUM-0326-E6UDXT-Z	2026-03-17T05:34:40.778Z	Permanent
PRJ1773746860453	LPT-ON-0326-5JUHYK-6	2026-03-24T04:50:46.093Z	Permanent
PRJ1773724147996	AST001	2026-03-27T05:24:12.935Z	DC
LOC-0426-222627-P	MON-LOC-0426-RZQZ0T-C	2026-04-03T10:10:14.422Z	Permanent
LOC-0426-790924-P	SRV-MUM-0426-FC88BN-6	2026-04-15T11:57:42.603Z	DC
LOC-0426-790924-P	ACC-MUM-0426-OMRMVJ-B	2026-04-18T12:15:26.559Z	Permanent
LOC-0426-576345-P	PRT-MUM-0526-RHAOIO-D	2026-05-02T10:02:42.880Z	Permanent
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
1	PO-1774588802411-493	1	as	\N	1	Nos	0	0	\N	2026-03-27T05:20:02.411Z	Pending
2	PO-1774588802411-493	2	asdas	\N	1	Nos	0	0	\N	2026-03-27T05:20:02.411Z	Pending
3	PO-1774588802411-493	3	asdasd	\N	1	Nos	0	0	\N	2026-03-27T05:20:02.411Z	Pending
4	PO-1775130510948-678	1	ARRI L7-C Plus RGB LED Fresnel Light with 23' Power Cord Kit	2025-12-20	2	EACH	307608	615216	\N	2026-04-02T11:48:30.951Z	Pending
5	PO-1775130510948-678	2	Astera LunaBulb LED Bulb with PrepCase Kit (Set of 8)	2025-12-20	1	EACH	135984	135984	\N	2026-04-02T11:48:30.951Z	Pending
6	PO-1775130510948-678	3	Atomos 7	2025-12-20	1	EACH	98730	98730	\N	2026-04-02T11:48:30.951Z	Shipped
7	PO-1775130510948-678	4	HIVE LIGHTING Zoom Reflector, Barndoors, and Grid Kit	2025-12-20	2	EACH	74862	149724	\N	2026-04-02T11:48:30.951Z	Pending
8	PO-1775130510948-678	5	Kupo Heavy-Duty Tilt Head With Crank Handle	2025-12-20	2	EACH	73924	147848	\N	2026-04-02T11:48:30.951Z	Pending
9	PO-1775130510948-678	6	Kupo Wind-Up Stand with 2-Section Low Base	2025-12-20	4	EACH	52685	210740	\N	2026-04-02T11:48:30.951Z	Pending
10	PO-1775130510948-678	7	Aputure INFINIBAR PB12 RGB LED Light Panel (4')	2025-12-20	4	EACH	47961	191844	\N	2026-04-02T11:48:30.951Z	Pending
11	PO-1775130510948-678	8	amaran 300c RGB LED Monolight (Gray)	2025-12-20	4	EACH	37136	148544	\N	2026-04-02T11:48:30.951Z	Pending
12	PO-1775130510948-678	9	Kupo C-Stand Overhead Shooting Kit 4 with Turtle Base	2025-12-20	5	EACH	36465	182325	\N	2026-04-02T11:48:30.951Z	Pending
13	PO-1775130510948-678	10	amaran Spotlight SE 36?? Lens Kit	2025-12-20	4	EACH	29518.25	118073	\N	2026-04-02T11:48:30.951Z	Pending
14	PO-1775130510948-678	11	Matthews Hollywood Junior Offset Arm	2025-12-20	5	EACH	17809	89045	\N	2026-04-02T11:48:30.951Z	Pending
15	PO-1775130510948-678	12	Hollyland LARK M2S Ultimate Combo 2-Person Wireless Microphone System for Cameras and Mobile Devices (2.4 GHz, Space Gray)	2025-12-20	7	EACH	11641	81487	\N	2026-04-02T11:48:30.951Z	Pending
16	PO-1775130510948-678	13	Kupo KS-207 Swivel Junior Receiver Adapter	2025-12-20	15	EACH	11279	169185	\N	2026-04-02T11:48:30.951Z	Pending
17	PO-1775130510948-678	14	Logitech MX Master 3S	2025-12-20	5	EACH	8159	40795	\N	2026-04-02T11:48:30.951Z	Pending
18	PO-1775130510948-678	15	Impact Heavy-Duty 13' Adjustable Background Crossbar (Black)	2025-12-20	10	EACH	7931	79310	\N	2026-04-02T11:48:30.951Z	Pending
19	PO-1775130510948-678	16	Kupo Super Viser Clamp (End Jaw, 9	2025-12-20	5	EACH	7408	37040	\N	2026-04-02T11:48:30.951Z	Pending
20	PO-1775130510948-678	17	SmallRig Horizontal-to-Vertical Mount Plate Kit for Mirrorless Cameras	2025-12-20	4	EACH	7213	28852	\N	2026-04-02T11:48:30.951Z	Pending
21	PO-1775130510948-678	18	Kupo 4-1/2	2025-12-20	10	EACH	6705	67050	\N	2026-04-02T11:48:30.951Z	Pending
22	PO-1775130510948-678	19	Smallrig 2903	2025-12-20	1	EACH	5122	5122	\N	2026-04-02T11:48:30.951Z	Pending
23	PO-1775130510948-678	20	Kupo Right-Angle Baby Adapter	2025-12-20	10	EACH	4540	45400	\N	2026-04-02T11:48:30.951Z	Pending
24	PO-1775130510948-678	21	SmallRig 3043 Aluminum Parabolic Ball Head with Quick Release Plate	2025-12-20	4	EACH	3072	12288	\N	2026-04-02T11:48:30.951Z	Pending
25	PO-1775130510948-678	22	Coast SG300 High-Vis Glow Safety Gloves (Large)	2025-12-20	4	EACH	935	3740	\N	2026-04-02T11:48:30.951Z	Pending
30	PO-1777713671754-991	1	HP LaserJet 15T	\N	1	undefined	15999	15999	\N	2026-05-02T10:02:56.829Z	Shipped
26	PO-1776253459157-109	1	Dell PE R660XS	\N	1	Nos	0	0	SRV-MUM-0426-FC88BN-6	2026-04-15T11:44:19.157Z	Shipped
\.


--
-- Data for Name: project_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.project_orders (id, projectid, orderno, orderdate, consigneename, consigneeaddress, consigneegstin, consigneestate, consigneestatecode, buyername, buyeraddress, buyergstin, buyerstate, buyerstatecode, createdby, "timestamp", ponumber, podate, vendorname, totalamount, status, is_deleted, deleted_at) FROM stdin;
ORD-1773728188787-440	PRJ1773724147996	01	2026-03-18	Anurag	Home	GHJ	Gujarat	87						System	2026-03-17T06:16:28.787Z	\N	\N	\N	0	\N	0	\N
ORD-1773748410984-462	PRJ1773748315543	I8-19870659 V1		Rinto V	Amazon Seller Services Private Limited\n401 to 425 Vipul Agora 4th Floor,\nFourth Floor of the Vipul Agora Commercial Complex\nMG road (Mehrauli-Gurgaon Road).\nGurgaon, Haryana 122001	06AAICA3918J1ZM	Haryana	122001	Rinto V	Global Finance Operations - Scanning Team (Amazon Development Centre (India)\nPvt Ltd.)\nPlot No.12/P, 13, 14 and 15/P, Financial District, Nanakramguda,\nSerilingampally Mandal, Hyderabad, Telangana 500032\nIndia	06AAICA3918J1ZM	Telangana	500032	System	2026-03-17T11:53:30.984Z	\N	\N	\N	0	\N	0	\N
PO-1774588802411-493	PRJ1773724130572	\N	\N	adas	c-4 Goldline Business Centre\nLink Rd\nMalad (W)	asda	Maharashtra	Maharashtra	asda	c-4 Goldline Business Centre\nLink Rd\nMalad (W)	asd	Maharashtra	Maharashtra	\N	2026-03-27T05:20:02.411Z	I8-19870659	2026-03-27	Malad	0	Active	0	\N
PO-1775130510948-678	LOC-0426-222627-P	\N	\N	RintoV	Amazon Seller Services Private Limited\n401 to 425 Vipul Agora 4th Floor,\nFourth Floor of the Vipul Agora Commercial Complex\nMG road (Mehrauli-Gurgaon Road).\nGurgaon, Haryana 122001	06AAICA3918J1ZM 	Telangana	\N	Rinto V	Global Finance Operations - Scanning Team (Amazon Development Centre (India)\nPvt Ltd.)\nPlot No.12/P, 13, 14 and 15/P, Financial District, Nanakramguda,\nSerilingampally Mandal, Hyderabad, Telangana 500032\nIndia	06AAICA3918J1ZM 	Haryana	\N	\N	2026-04-02T11:48:30.951Z	I8-19870659	2025-08-12	\N	2.658342e+06	Active	0	\N
PO-1776253459157-109	LOC-0426-790924-P	\N	\N	assaassaas	saasas	asassa	assaasa	assasaas	Aassa	asaas	assa	saasas	sasa	\N	2026-04-15T11:44:19.157Z	PO89765	2026-04-15	\N	0	Active	0	\N
PO-1777713671754-991	LOC-0426-576345-P	\N	\N	Consg1	Malad West	AZT143	Maharashtra	27	Buyer1	Dadar West	AZT145	Maharashtra	27	\N	2026-05-02T09:21:11.754Z	PO897651	2026-05-02	HP	15999	Active	0	\N
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.projects (id, projectname, clientname, description, status, startdate, enddate, createdby, "timestamp", location, currency, owneremail, coordinatoremail, qrcode, type, consigneename, consigneeaddress, consigneegstin, consigneestate, consigneestatecode, buyername, buyeraddress, buyergstin, buyerstate, buyerstatecode, is_deleted, deleted_at, initials) FROM stdin;
LOC-0426-222627-P	Amazon Hyderabad 	Rinto V	\N	Active	2025-07-01	2025-12-20	admin	2026-04-02T11:36:08.855Z	MUMBAI	INR	\N	itsupport@cineom.in	data:image/png;base64,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	\N	RintoV	Amazon Seller Services Private Limited\n401 to 425 Vipul Agora 4th Floor,\nFourth Floor of the Vipul Agora Commercial Complex\nMG road (Mehrauli-Gurgaon Road).\nGurgaon, Haryana 122001	06AAICA3918J1ZM 	Telangana	\N	Rinto V	Global Finance Operations - Scanning Team (Amazon Development Centre (India)\nPvt Ltd.)\nPlot No.12/P, 13, 14 and 15/P, Financial District, Nanakramguda,\nSerilingampally Mandal, Hyderabad, Telangana 500032\nIndia	06AAICA3918J1ZM 	Haryana	\N	0	\N	AH
LOC-0426-790924-P	Dneg	Shailesh	\N	Active	2026-04-14	2026-04-17	admin	2026-04-15T11:42:40.015Z	Mumbai	INR			data:image/png;base64,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	\N											0	\N	DNG
LOC-0426-576345-P	Sample	Anurag	\N	Planning	\N	\N	admin	2026-04-20T06:25:51.276Z	MUMBAI	INR	\N	\N	data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAAAklEQVR4AewaftIAAAwbSURBVO3BUWolibIkQI9A+9+yT/8W78KgRGSpTpjZ9D8BAE7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJzzlQ83M+HvapsnZiZvaZs3zUyeaJsnZibf1TZPzEze1DafambC39U2n2oDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAOV/hf2ob/jQz+e3a5omZyRNt80TbvKlt3tI2/4KZyVva5k1tw59mJvxpAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDlf4UfNTH67tvkXtM13zUz+BTOTN7XNbzcz4e+amfx2bcPP2AAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JyvwC81M3lL2zwxM3lT2/x2M5Mn2uZNMxO4bAMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5X4Ffqm3eMjN5om34u2YmT7TNEzMT+AQbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAzvkKP6ptuGNm8kTbPDEzeaJtvmtm8qaZyRNt88TM5Im2+VRtwx0bAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAzvkK/9PMhL9rZvJdbfOmtnliZvJE2zwxM/mutnliZvJE2zwxM3mibZ6YmXxX27xpZgL/PxsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDOmf4n8AvNTN7SNvyMmckTbQO8ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5X/lwM5Mn2uaJmclb2uaJmcm/oG3408zkibbhZ8xMvqttnpiZPNE2b5qZPNE23zUzeVPbfKoNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDOmf4n/JiZyXe1zRMzkze1zRMzk9+ubT7ZzORTtc2bZia/Xds8MTN5om1+u5nJE23zqTYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCc8xV+VNv8dm3zxMzkibZ5y8zkXzAzeaJtfru2eWJm8qaZyRNt86na5k0zk7e0DX/aAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM5XPtzMhJ/RNvxpZvKmmcmnapsnZiafambyRNs8MTN5U9u8ZWbyRNt8qg0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnTP+TDzYz+VRt86aZyadqm3/BzORTtQ0/Y2byprZ5YmbyXW3Dz9gAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzlf4n9rmt5uZPNE2T7TNm2Ym39U2n6xt+NPM5Im2eWJm8pa24U8zkze1zafaAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM5XPlzbPDEzeaJtPtXM5Im2eaJtfruZyRNtw89omydmJr/dzORNbfPEzOSJtvmumQk/YwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHO+8uFmJvyMtnliZvJE23zXzORNbfPEzIS/q22emJm8pW3eNDN5om2emJm8pW340wYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzpv8Jp8xM3tQ2T8xM3tI2T8xM3tQ2v93MhD+1zb9gZvKp2oY/bQCAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADjnK/xPM5NP1Tb/grb5rpnJm9rmTTMTfkbbvGVm8kTb/Ava5omZCX/PBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHO+8uFmJk+0zRMzk7e0zZtmJvyMmcmb2ua7ZiZvaps3zUyeaJu3zEze1DZPzEze0jb8jA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnfOXDtc2b2uYtM5M3tc0TM5O3tM0TM5M3tc0TM5NPNTN5U9s8MTP5rrbh/2ob/p4NAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA50z/E/6Pmclb2uaJmckna5vvmpk80TZPzEz+BW3zlpnJE23zL5iZ8Pe0DT9jAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAc6b/CfxCM5O3tM2bZiZPtM2nmpm8qW2emJl8V9v8C2Ymb2qb75qZvKltPtUGADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAc77y4WYm/F1t85a2eWJm8slmJt/VNv+CtnliZvLbzUyeaBv+1Db8aQMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5X+F/ahv+NDP57WYmn2xm8kTbfNfM5E1t86a2eWJm8pa2+Re0zRMzk+9qmydmJk+0zafaAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM5X+FEzk9+ubf4FbfOWmcmb2uZTtc0TM5M3tc1bZiafbGby27UNf9oAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzlfgl5qZfFfbvKltnpiZPNE2T8xMPlXbPDEzeUvb/AtmJk+0zRMzE/6eDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOd8BUjbPDEzeaJtnpiZvKVt3tQ2T8xM3tQ2b5mZ/AtmJr/dzOSJtvlUGwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnPMVflTb8DPa5i0zkyfa5k1t88TM5LtmJk+0zRMzkyfa5rebmbypbZ6YmTzRNm+ZmTzRNvxpAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDlf4X+amfB3zUy+q23+BTOTN7XNd81M3tQ2T8xM+Blt86aZCX/PBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHOm/wkAcMoGADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAORsA4JwNAHDOBgA4ZwMAnLMBAM7ZAADnbACAczYAwDkbAOCcDQBwzgYAOGcDAJyzAQDO2QAA52wAgHM2AMA5GwDgnA0AcM4GADhnAwCcswEAztkAAOdsAIBzNgDAOf8PThw6BEwyiKsAAAAASUVORK5CYII=	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	S
\.


--
-- Data for Name: quantity_event_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quantity_event_lines (event_id, asset_id, unit, delta_available, delta_total) FROM stdin;
1	LPT-MUM-0326-E6UDXT-Z	pcs	3	3
2	LPT-MUM-0326-E6UDXT-Z	pcs	-1	-1
3	AST002	pcs	3	3
4	AST002	pcs	-3	-3
5	ACC-MUM-0426-B8FU04-B	pcs	3	3
9	ACC-MUM-0426-B8FU04-B	pcs	-1	-1
10	ACC-MUM-0426-B8FU04-B	pcs	-1	-1
11	ACC-MUM-0426-B8FU04-B	pcs	-1	-1
12	ACC-MUM-0426-B8FU04-B	pcs	1	1
13	ACC-MUM-0426-B8FU04-B	pcs	1	1
14	ACC-MUM-0426-B8FU04-B	pcs	1	1
15	ACC-MUM-0426-B8FU04-B	pcs	-1	-1
16	ACC-MUM-0426-B8FU04-B	pcs	1	1
17	ACC-MUM-0426-B8FU04-B	pcs	-2	-2
18	ACC-MUM-0426-B8FU04-B	pcs	1	1
\.


--
-- Data for Name: quantity_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quantity_events (id, root_id, type, actor, "timestamp", note, metadata_json) FROM stdin;
1	LPT-MUM-0326-E6UDXT-Z	INIT	admin	2026-03-23T11:40:13.131Z	\N	{"source":"asset_update_init"}
2	LPT-MUM-0326-E6UDXT-Z	SPLIT	web	2026-03-24T04:50:46.098Z	Split SMPLP and assigned to Project PRJ1773746860453	{"parentId":"LPT-MUM-0326-E6UDXT-Z","splitCount":1,"serials":"SMPLP","assignedTo":"PROJECT:PRJ1773746860453"}
3	AST002	INIT	admin	2026-04-04T11:45:52.937Z	\N	{"source":"asset_update_init"}
4	AST002	SPLIT	web	2026-04-04T11:48:18.689Z	Split 3 units to individual assets	{"parentId":"AST002","splitCount":3,"serials":"SN1002, SN1003, SN1004","assignedTo":null}
5	ACC-MUM-0426-B8FU04-B	INIT	admin	2026-04-07T08:25:40.389Z	\N	{"source":"asset_create"}
9	ACC-MUM-0426-B8FU04-B	SPLIT	web	2026-04-18T04:47:31.187Z	Split SN1 and assigned to Project LOC-0426-790924-P	{"parentId":"ACC-MUM-0426-B8FU04-B","splitCount":1,"serials":"SN1","assignedTo":"PROJECT:LOC-0426-790924-P"}
10	ACC-MUM-0426-B8FU04-B	SPLIT	web	2026-04-18T04:47:41.411Z	Split SN2 and assigned to Project LOC-0426-790924-P	{"parentId":"ACC-MUM-0426-B8FU04-B","splitCount":1,"serials":"SN2","assignedTo":"PROJECT:LOC-0426-790924-P"}
11	ACC-MUM-0426-B8FU04-B	SPLIT	web	2026-04-18T04:49:53.144Z	Split SN3 and assigned to Project LOC-0426-222627-P	{"parentId":"ACC-MUM-0426-B8FU04-B","splitCount":1,"serials":"SN3","assignedTo":"PROJECT:LOC-0426-222627-P"}
12	ACC-MUM-0426-B8FU04-B	UNSPLIT	web	2026-04-18T06:39:59.396Z	Merged children: ACC-MUM-0426-M6PTWY-D back to parent	{"parentId":"ACC-MUM-0426-B8FU04-B","mergedChildren":["ACC-MUM-0426-M6PTWY-D"]}
13	ACC-MUM-0426-B8FU04-B	UNSPLIT	web	2026-04-18T06:40:16.761Z	Merged children: ACC-MUM-0426-AY2ETP-B back to parent	{"parentId":"ACC-MUM-0426-B8FU04-B","mergedChildren":["ACC-MUM-0426-AY2ETP-B"]}
14	ACC-MUM-0426-B8FU04-B	UNSPLIT	web	2026-04-18T06:40:38.043Z	Merged children: ACC-MUM-0426-1560D6-N back to parent	{"parentId":"ACC-MUM-0426-B8FU04-B","mergedChildren":["ACC-MUM-0426-1560D6-N"]}
15	ACC-MUM-0426-B8FU04-B	SPLIT	web	2026-04-18T12:15:05.434Z	Split SN3 and assigned to Project LOC-0426-790924-P	{"parentId":"ACC-MUM-0426-B8FU04-B","splitCount":1,"serials":"SN3","assignedTo":"PROJECT:LOC-0426-790924-P"}
16	ACC-MUM-0426-B8FU04-B	UNSPLIT	web	2026-04-18T12:15:11.401Z	Merged children: ACC-MUM-0426-6TJON3-7 back to parent	{"parentId":"ACC-MUM-0426-B8FU04-B","mergedChildren":["ACC-MUM-0426-6TJON3-7"]}
17	ACC-MUM-0426-B8FU04-B	SPLIT	web	2026-04-18T12:15:26.586Z	Split SN2, SN1 and assigned to Project LOC-0426-790924-P	{"parentId":"ACC-MUM-0426-B8FU04-B","splitCount":2,"serials":"SN2, SN1","assignedTo":"PROJECT:LOC-0426-790924-P"}
18	ACC-MUM-0426-B8FU04-B	UNSPLIT	web	2026-04-18T12:15:40.179Z	Merged children: ACC-MUM-0426-WVLA8Z-N back to parent	{"parentId":"ACC-MUM-0426-B8FU04-B","mergedChildren":["ACC-MUM-0426-WVLA8Z-N"]}
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permissions (role_name, permission_key) FROM stdin;
superuser	module.assets.access
superuser	module.admin.access
superuser	module.settings.access
superuser	module.employees.access
superuser	module.network_scanner.access
superuser	module.network.access
superuser	asset.view
superuser	asset.create
superuser	asset.edit
superuser	asset.delete
superuser	asset.search
superuser	category.create
superuser	category.delete
superuser	user.manage
superuser	logs.view
admin	module.assets.access
admin	module.admin.access
admin	module.settings.access
admin	module.employees.access
admin	module.network_scanner.access
admin	module.network.access
admin	asset.view
admin	asset.create
admin	asset.edit
admin	asset.delete
admin	asset.search
admin	category.create
admin	user.manage
admin	logs.view
manager	module.assets.access
manager	asset.view
manager	asset.create
manager	asset.edit
manager	asset.search
manager	category.create
user	module.assets.access
user	asset.view
user	asset.create
user	asset.edit
user	asset.search
client	module.assets.access
client	asset.view
client	asset.search
it_user	module.assets.access
it_user	module.network_scanner.access
it_user	module.network.access
it_user	asset.view
it_user	asset.search
it_manager	module.assets.access
it_manager	module.network_scanner.access
it_manager	module.network.access
it_manager	asset.view
it_manager	asset.create
it_manager	asset.edit
it_manager	asset.search
it_manager	user.manage
superuser	asset.view_price
superuser	asset.edit_price
admin	asset.view_price
admin	asset.edit_price
manager	asset.view_price
manager	asset.edit_price
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (name, description) FROM stdin;
superuser	System owner with full access
admin	Company administrator with full access to modules
manager	Manager with elevated asset and category access
user	Standard internal user
client	External client user
it_user	IT personnel with network access
it_manager	IT manager with network management access
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
admin	itdevelopment@cineom.in	$2b$12$UyLizpxrMbFLEQt7rYss.OxzoHJpGyNlbwkxrDmwakgVPOKpOp4YS	superuser	\N	25451fa6-82a7-414b-9b40-341bcd1b7286	25451fa6-82a7-414b-9b40-341bcd1b7286	1198	\N	2026-03-16 11:16:36
SwapnilM	Swapnil Marathe	$2b$12$deCrXYi7UKavtMjqxtK0Ge98gWI/C4GeilaDKyU0Jk2IvdygnMEsm	manager	\N	25451fa6-82a7-414b-9b40-341bcd1b7286	25451fa6-82a7-414b-9b40-341bcd1b7286	\N	\N	\N
\.


--
-- Name: asset_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_history_id_seq', 43, true);


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 95, true);


--
-- Name: auth_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.auth_tokens_id_seq', 1, false);


--
-- Name: company_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.company_templates_id_seq', 1, true);


--
-- Name: dc_item_mappings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dc_item_mappings_id_seq', 1, false);


--
-- Name: knex_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.knex_migrations_id_seq', 1, true);


--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.knex_migrations_lock_index_seq', 1, true);


--
-- Name: password_resets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.password_resets_id_seq', 1, false);


--
-- Name: project_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.project_history_id_seq', 1, false);


--
-- Name: project_order_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.project_order_items_id_seq', 30, true);


--
-- Name: quantity_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.quantity_events_id_seq', 18, true);


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
    ADD CONSTRAINT auth_tokens_pkey PRIMARY KEY (id);


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
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


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
-- Name: idx_auth_tokens_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_auth_tokens_hash ON public.auth_tokens USING btree (token_hash);


--
-- Name: idx_password_resets_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_password_resets_hash ON public.password_resets USING btree (token_hash);


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
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict XFI5T1taXGgZCJaVCQPzLwhvVENHlfnwfQto7S0F1Q0UrbtA7jhNECeCPxVKRDn

