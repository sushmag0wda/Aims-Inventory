# core/signals.py (NEW FILE - ADD THIS CODE)

from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Student, PendingReport

# Map item codes (frontend/Dept model style) to the fields in the Department model
DEPT_FIELD_MAP = {
    '2PN': 'two_hundred_notebook',
    '2PR': 'two_hundred_record',
    '2PO': 'two_hundred_observation',
    '1PN': 'one_hundred_notebook',
    '1PR': 'one_hundred_record',
    '1PO': 'one_hundred_observation',
}

@receiver(post_save, sender=Student)
def create_initial_pending_report(sender, instance, created, **kwargs):
    """
    Creates the initial PendingReport record for a new Student based on their
    department's allotment. The OneToOneField on PendingReport will ensure 
    this runs only once per student.
    """
    if created:
        department = instance.department
        if not department:
            print(f"Warning: Student {instance.usn} created without Department link. Cannot create PendingReport.")
            return

        report_data = {
            'student': instance,
            'usn': instance.usn,
            'name': instance.name,
            'course': department.course,
        }
        
        # Map Department Allotment fields to PendingReport model fields
        # PendingReport fields: pn2, pr2, po2, pn1, pr1, po1
        
        # 2PN -> Department field: two_hundred_notebook -> PendingReport field: pn2
        report_data['pn2'] = getattr(department, DEPT_FIELD_MAP['2PN'], 0) or 0
        report_data['pr2'] = getattr(department, DEPT_FIELD_MAP['2PR'], 0) or 0
        report_data['po2'] = getattr(department, DEPT_FIELD_MAP['2PO'], 0) or 0
        
        # 1PN -> Department field: one_hundred_notebook -> PendingReport field: pn1
        report_data['pn1'] = getattr(department, DEPT_FIELD_MAP['1PN'], 0) or 0
        report_data['pr1'] = getattr(department, DEPT_FIELD_MAP['1PR'], 0) or 0
        report_data['po1'] = getattr(department, DEPT_FIELD_MAP['1PO'], 0) or 0

        try:
            # Create the initial PendingReport instance
            PendingReport.objects.create(**report_data)
        except Exception as e:
            # Handle the case if the student already had a report (unlikely with 'created')
            print(f"Error creating initial PendingReport for {instance.usn}: {e}")