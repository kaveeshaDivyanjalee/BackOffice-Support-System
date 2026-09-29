"""
SQLAlchemy Database Models and Pydantic request/response schemas 
used across the BackOffice Support System backend.
"""
from pydantic import BaseModel
from sqlalchemy import Column, String, Integer, Float, Boolean
from sqlalchemy.orm import declarative_base

# SQLAlchemy Base Definition
Base = declarative_base()


# ----------------------------------------------------------------------
# 1. SQLAlchemy Database Models
# ----------------------------------------------------------------------
class CustomerStatus(Base):
    __tablename__ = "customer_status"

    customer_id = Column(String, primary_key=True, index=True)
    bb_status = Column(String, nullable=True)
    voice_status = Column(String, nullable=True)
    peotv_1_status = Column(String, nullable=True)
    peotv_2_status = Column(String, nullable=True)
    peotv_3_status = Column(String, nullable=True)
    ont_type = Column(String, nullable=True)
    ont_model = Column(String, nullable=True)
    ont_serial_no = Column(String, nullable=True)
    ont_ssid_list = Column(String, nullable=True)
    existing_faults_voice = Column(String, nullable=True)
    existing_faults_bb = Column(String, nullable=True)
    existing_faults_iptv = Column(String, nullable=True)
    nw_faults = Column(String, nullable=True)
    special_attribute = Column(Integer, nullable=True)
    pon_status = Column(String, nullable=True)
    ont_power_status = Column(String, nullable=True)
    tx_power_level = Column(Float, nullable=True)
    rx_power_level = Column(Float, nullable=True)
    no_of_devices_through_wifi = Column(Integer, nullable=True)
    no_of_devices_through_lan = Column(Integer, nullable=True)
    nms_service_port = Column(String, nullable=True)
    nms_service_port_status = Column(String, nullable=True)
    lan_1_port_status = Column(String, nullable=True)
    lan_2_port_status = Column(String, nullable=True)
    lan_3_port_status = Column(String, nullable=True)
    lan_4_port_status = Column(String, nullable=True)
    ont_serial_n1 = Column(String, nullable=True)
    ont_voice_status_1 = Column(String, nullable=True)
    ont_voice_status_2 = Column(String, nullable=True)
    service_status_voice = Column(String, nullable=True)
    service_status_bb = Column(String, nullable=True)
    service_status_iptv = Column(String, nullable=True)
    pcrf_status = Column(String, nullable=True)
    static_ip_oss = Column(String, nullable=True)
    static_ip_isp = Column(String, nullable=True)
    session_count_iptv = Column(Integer, nullable=True)
    stb_mac = Column(String, nullable=True)
    stb_status = Column(String, nullable=True)
    stb_type = Column(String, nullable=True)
    stb_model = Column(String, nullable=True)
    iptv_ip_issued = Column(Boolean, nullable=True)
    stb_synced_status = Column(Boolean, nullable=True)
    voice_port = Column(String, nullable=True)
    tele_connected_port = Column(String, nullable=True)
    digi_map_updated = Column(Boolean, nullable=True)
    ims_registration_status = Column(Boolean, nullable=True)
    other1 = Column(String, nullable=True)
    other2 = Column(String, nullable=True)
    other3 = Column(Integer, nullable=True)


# ----------------------------------------------------------------------
# 2. Pydantic Request / Response Schemas
# ----------------------------------------------------------------------
class SupportQuery(BaseModel):
    agent: str
    subscriber_id: str
    query: str


class EmailChatRequest(BaseModel):
    message: str
    user_id: str = "020601"
    thread_id: str = "default_thread"


class UsageChatRequest(BaseModel):
    query: str
    session_id: str = "default"


class MainAgentChatRequest(BaseModel):
    message: str
    session_id: str = "default_main_session"