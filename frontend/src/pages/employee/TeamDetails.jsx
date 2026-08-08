import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageWrapper from '../../components/PageWrapper';
import { Users, ChevronRight, MessageSquare, Mail, Phone, Calendar, Network, MapPin, Briefcase, FileText } from 'lucide-react';
import { employeeAPI } from '../../utils/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';

export default function EmployeeTeamDetails() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    employeeAPI.getTeamMember(id)
      .then(r => setMember(r.data?.data || r.data))
      .catch(() => toast.error('Failed to load teammate details'))
      .finally(() => setLoading(false));
  }, [id]);

  const getAvatarInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <PageWrapper>
        <div className="flex justify-center items-center py-24">
          <LoadingSpinner />
        </div>
      </PageWrapper>
    );
  }

  if (!member) {
    return (
      <PageWrapper>
        <div className="text-center py-20 text-[#64748B]">
          <p className="text-lg font-semibold">Teammate details not found.</p>
          <button onClick={() => navigate('/employee/team')} className="mt-4 text-[#2563EB] hover:underline">
            Back to Team List
          </button>
        </div>
      </PageWrapper>
    );
  }

  const deptName = member.department?.name || member.department || '—';
  const roleName = member.role?.name || member.role || '—';
  const initials = getAvatarInitials(member.name);
  const avatarUrl = member.avatar || member.profileImage;

  return (
    <PageWrapper>
      <div className="font-sans text-[#0F172A] max-w-6xl mx-auto space-y-6 pb-20">
        
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-[13px] text-[#64748B] font-medium pt-2">
          <button onClick={() => navigate('/employee/team')} className="hover:text-[#2563EB] transition-colors flex items-center gap-1">
            <Users size={16} /> My Team
          </button>
          <ChevronRight size={16} />
          <span className="text-[#0F172A]">{member.name}</span>
        </div>

        {/* Profile Summary Card */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden p-6 sm:p-8 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              {/* Avatar */}
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#1E293B] text-white flex items-center justify-center text-[32px] font-bold shrink-0 relative border border-[#E2E8F0] shadow-sm overflow-hidden">
                {avatarUrl ? <img src={avatarUrl} alt={member.name} className="w-full h-full object-cover" /> : initials}
                {member.status === 'Active' && (
                  <div className="absolute bottom-1 right-1 w-4 h-4 bg-[#16A34A] border-2 border-white rounded-full"></div>
                )}
              </div>
              
              {/* Name & Primary Details */}
              <div>
                <div className="flex items-center gap-3 mb-1.5">
                  <h1 className="text-[28px] font-bold tracking-tight text-[#0F172A] leading-none">{member.name}</h1>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold ${
                    member.status === 'Active' ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#EF4444]/10 text-[#EF4444]'
                  }`}>
                    {member.status || 'Active'}
                  </span>
                </div>
                <p className="text-[15px] text-[#0F172A] font-medium mb-1">
                  {member.designation || 'Team Member'} <span className="text-[#CBD5E1] mx-1">•</span> {deptName}
                </p>
              </div>
            </div>
        </div>

        {/* 3-Column Information Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Column 1: Identity & Contact */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-6 space-y-6">
            <h2 className="text-[14px] font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-2 border-b border-[#E2E8F0] pb-3">
              <Mail size={16} className="text-[#64748B]" />
              Identity & Contact
            </h2>
            <div className="space-y-5">
              <div>
                <span className="block text-[12px] font-medium text-[#64748B] mb-1">Email Address</span>
                <a href={`mailto:${member.email}`} className="text-[14px] font-medium text-[#2563EB] hover:underline flex items-center gap-1.5 truncate">
                  {member.email}
                </a>
              </div>
              {member.phone && (
                <div>
                  <span className="block text-[12px] font-medium text-[#64748B] mb-1">Phone Number</span>
                  <span className="text-[14px] font-medium text-[#0F172A]">
                    {member.phone}
                  </span>
                </div>
              )}
              {member.joinDate && (
                <div>
                  <span className="block text-[12px] font-medium text-[#64748B] mb-1">Joined Organization</span>
                  <span className="text-[14px] font-medium text-[#0F172A] flex items-center gap-1.5">
                    <Calendar size={14} className="text-[#94A3B8]" /> {fmtDate(member.joinDate)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Column 2: Corporate Structure */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-6 space-y-6">
            <h2 className="text-[14px] font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-2 border-b border-[#E2E8F0] pb-3">
              <Network size={16} className="text-[#64748B]" />
              Corporate Info
            </h2>
            <div className="space-y-5">
              <div>
                <span className="block text-[12px] font-medium text-[#64748B] mb-1">Department</span>
                <span className="text-[14px] font-medium text-[#0F172A]">{deptName}</span>
              </div>
              {member.employeeId && (
                <div>
                  <span className="block text-[12px] font-medium text-[#64748B] mb-1">Employee ID</span>
                  <span className="text-[14px] font-medium text-[#0F172A] font-mono">{member.employeeId}</span>
                </div>
              )}
              <div>
                <span className="block text-[12px] font-medium text-[#64748B] mb-1">Assigned Role</span>
                <span className="text-[14px] font-medium text-[#0F172A]">{roleName}</span>
              </div>
            </div>
          </div>

          {/* Column 3: Shared Projects */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-6 space-y-6 relative">
            <h2 className="text-[14px] font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-2 border-b border-[#E2E8F0] pb-3">
              <Briefcase size={16} className="text-[#64748B]" />
              Shared Projects
            </h2>
            <div className="space-y-3">
              {member.sharedProjects && member.sharedProjects.length > 0 ? (
                member.sharedProjects.map((project, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg">
                    <div className="w-8 h-8 rounded bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                      <Briefcase size={14} />
                    </div>
                    <span className="text-[13px] font-medium text-[#0F172A]">{project}</span>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 border border-dashed border-[#E2E8F0] rounded-lg">
                  <span className="text-xs text-slate-400">No shared projects.</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Bio & Skills Section */}
        {(member.bio || (member.skills && member.skills.length > 0)) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {member.bio && (
              <div className="md:col-span-2 bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-6 space-y-4">
                <h2 className="text-[14px] font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-2 border-b border-[#E2E8F0] pb-3">
                  <FileText size={16} className="text-[#64748B]" />
                  Biography
                </h2>
                <p className="text-[14px] text-slate-600 leading-relaxed whitespace-pre-wrap">{member.bio}</p>
              </div>
            )}
            
            {member.skills && member.skills.length > 0 && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-6 space-y-4">
                <h2 className="text-[14px] font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-2 border-b border-[#E2E8F0] pb-3">
                  <Briefcase size={16} className="text-[#64748B]" />
                  Skills & Expertise
                </h2>
                <div className="flex flex-wrap gap-2">
                  {member.skills.map((skill, index) => (
                    <span key={index} className="text-[12px] font-semibold bg-orange-50 text-orange-600 border border-orange-100 rounded-full px-3 py-1">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </PageWrapper>
  );
}
